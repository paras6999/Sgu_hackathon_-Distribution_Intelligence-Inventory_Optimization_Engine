"""Shared baseline mechanics (owner: M2): lot picking, MRSL, storage/credit limits, trucks and freight.

Both baselines obey the same stock, truck, storage, credit and MRSL limits as the engine (FR-10).
Freight follows A11-A13 (trip cost from the lane, festival premium on FTL, PTL slab rate with a
minimum charge, volumetric weight).

TODO(M1 hand-off): once dia_engine.optimize.freight lands, build_plan should call its
ftl_trip_cost / ptl_cost / build_loads so every policy pays exactly the same freight.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from dia_engine.config import get_config
from dia_types import (
    ExpectedKpis, LineStatus, Lot, Plan, PlanLine, PolicyName, Scenario, ShipMode, Sku, Snapshot, SolveInfo,
    SolveStatus, TempClass, Truck, TruckClass,
)


@dataclass
class Draft:
    """One lot -> distributor shipment before truck assignment."""
    sku: Sku
    lot: Lot
    to_id: str
    cases: int


def code(node_id: str) -> str:
    return node_id.split("-")[0]


def mrsl_ok(sku: Sku, lot: Lot, ship_date: date, lead_days: float, mrsl_fraction: float) -> bool:
    """RSL on arrival >= MRSL x shelf life (PRD 6.6.3 arc filter)."""
    rsl_arrival = (lot.expiry_date - ship_date).days - math.ceil(lead_days)
    return rsl_arrival >= mrsl_fraction * sku.shelf_life_days


def take_lots(lots: list[Lot], remaining: dict[str, float], qty: int, fefo: bool) -> list[tuple[Lot, int]]:
    """Take up to qty whole cases from lots, oldest manufacture first (FIFO) or soonest expiry first (FEFO)."""
    order = sorted(lots, key=(lambda l: (l.expiry_date, l.lot_id)) if fefo else (lambda l: (l.mfg_date, l.lot_id)))
    out = []
    for lot in order:
        if qty <= 0:
            break
        n = min(qty, int(remaining[lot.lot_id]))
        if n > 0:
            remaining[lot.lot_id] -= n
            qty -= n
            out.append((lot, n))
    return out


def apply_limits(drafts: list[Draft], snapshot: Snapshot) -> list[Draft]:
    """Cut each distributor's lines pro rata to fit free storage (m3) and available credit (INR)."""
    by_dist: dict[str, list[Draft]] = defaultdict(list)
    for d in drafts:
        by_dist[d.to_id].append(d)
    out = []
    for dist, ds in by_dist.items():
        m3 = sum(d.cases * d.sku.m3_per_case for d in ds)
        value = sum(d.cases * d.sku.price_inr for d in ds)
        f = 1.0
        if m3 > 0:
            f = min(f, snapshot.storage_free_m3.get(dist, math.inf) / m3)
        if value > 0:
            f = min(f, snapshot.credit_available_inr.get(dist, math.inf) / value)
        for d in ds:
            n = int(math.floor(d.cases * min(f, 1.0) + 1e-9))
            if n > 0:
                out.append(Draft(d.sku, d.lot, d.to_id, n))
    return out


def festival_premium(ship_date: date) -> float:
    p = get_config().costs.festival_freight_premium
    return p.factor if ship_date.month in p.months else 1.0


def cheaper_mode(load_fraction: float, ftl_cost: float, ptl_cost: float) -> bool:
    """Default lane rule (Baseline A): PTL when it costs less than the FTL trips the load needs."""
    return ptl_cost < ftl_cost


def build_plan(drafts: list[Draft], scenario: Scenario, as_of: date, temp_class: TempClass, policy: str,
               plan_id: str, seconds: float, use_ptl_rule=cheaper_mode) -> Plan:
    """Group drafts by lane, choose FTL vs PTL (ambient only) with use_ptl_rule(load_fraction, ftl_cost,
    ptl_cost), pack whole cases into trucks, allocate freight. load_fraction = max(kg, m3 share) of one truck."""
    cfg = get_config()
    lanes = {(l.from_id, l.to_id): l for l in scenario.lanes}
    truck_class = TruckClass.REEF17 if temp_class is TempClass.CHILLED else TruckClass.AMB32
    cap = cfg.costs.ftl[truck_class.value]
    kg_per_m3 = cfg.costs.ptl.kg_per_m3
    premium = festival_premium(as_of)

    by_lane: dict[tuple[str, str], list[Draft]] = defaultdict(list)
    for d in drafts:
        if d.cases > 0:
            by_lane[(d.lot.depot_id, d.to_id)].append(d)

    lines: list[PlanLine] = []
    trucks: list[Truck] = []
    n_line = 0
    for (w, j), ds in sorted(by_lane.items()):
        lane = lanes[(w, j)]
        eta = as_of + timedelta(days=math.ceil(lane.lead_days_mean))
        kg = sum(d.cases * d.sku.kg_per_case for d in ds)
        m3 = sum(d.cases * d.sku.m3_per_case for d in ds)
        trip = lane.ftl_cost_inr[truck_class.value] * premium
        ftl_cost = math.ceil(max(kg / cap.kg, m3 / cap.m3)) * trip
        ptl_cost = max(lane.ptl_min_charge_inr, lane.ptl_rate_inr_per_kg * max(kg, kg_per_m3 * m3))
        load_fraction = max(kg / cap.kg, m3 / cap.m3)
        use_ptl = temp_class is TempClass.AMBIENT and use_ptl_rule(load_fraction, ftl_cost, ptl_cost)

        # loads: list of (truck_id, [(draft, cases)])
        loads: list[tuple[str, list[tuple[Draft, int]]]] = []
        if use_ptl:
            loads.append((f"C-{code(w)}-{code(j)}-01", [(d, d.cases) for d in ds]))
        else:
            todo = sorted(ds, key=lambda d: -max(d.cases * d.sku.kg_per_case / cap.kg, d.cases * d.sku.m3_per_case / cap.m3))
            left = {id(d): d.cases for d in todo}
            while any(left.values()):
                kg_rem, m3_rem, load = cap.kg, cap.m3, []
                for d in todo:
                    n = min(left[id(d)], int(kg_rem // d.sku.kg_per_case), int(m3_rem // d.sku.m3_per_case))
                    if n > 0:
                        load.append((d, n))
                        left[id(d)] -= n
                        kg_rem -= n * d.sku.kg_per_case
                        m3_rem -= n * d.sku.m3_per_case
                if not load:
                    raise ValueError(f"a single case of an item does not fit a {truck_class.value} truck")
                loads.append((f"T-{code(w)}-{code(j)}-{len(loads) + 1:02d}", load))

        for truck_id, load in loads:
            t_kg = sum(n * d.sku.kg_per_case for d, n in load)
            t_m3 = sum(n * d.sku.m3_per_case for d, n in load)
            if use_ptl:
                cost = ptl_cost
                shares = [n * max(d.sku.kg_per_case, kg_per_m3 * d.sku.m3_per_case) for d, n in load]
            else:
                cost = trip
                shares = [max(n * d.sku.kg_per_case / cap.kg, n * d.sku.m3_per_case / cap.m3) for d, n in load]
            ids = []
            for (d, n), sh in zip(load, shares):
                n_line += 1
                line_id = f"{plan_id}-v1-{n_line:03d}"
                ids.append(line_id)
                lines.append(PlanLine(
                    line_id=line_id, sku_id=d.sku.sku_id, sku_name=d.sku.name, lot_id=d.lot.lot_id,
                    expiry=d.lot.expiry_date, from_id=w, to_id=j, cases=n,
                    mode=ShipMode.PTL if use_ptl else ShipMode.FTL,
                    truck_id=None if use_ptl else truck_id, consignment_id=truck_id if use_ptl else None,
                    truck_class=None if use_ptl else truck_class, ship_date=as_of, eta=eta,
                    rsl_on_arrival_days=(d.lot.expiry_date - eta).days,
                    freight_alloc_inr=round(cost * sh / sum(shares), 2), reasons=[], status=LineStatus.PROPOSED))
            trucks.append(Truck(
                truck_id=truck_id, mode=ShipMode.PTL if use_ptl else ShipMode.FTL,
                truck_class=None if use_ptl else truck_class, from_id=w, to_id=j, ship_date=as_of,
                kg=round(t_kg, 3), m3=round(t_m3, 4),
                kg_pct=0.0 if use_ptl else round(100 * t_kg / cap.kg, 2),
                m3_pct=0.0 if use_ptl else round(100 * t_m3 / cap.m3, 2),
                cost_inr=round(cost, 2), line_ids=ids))

    freight = sum(t.cost_inr for t in trucks)
    return Plan(plan_id=plan_id, version=1, scenario_id=scenario.scenario_id, as_of=as_of, temp_class=temp_class,
                policy=PolicyName(policy), lines=lines, trucks=trucks,
                expected_kpis=ExpectedKpis(freight_inr=freight, total_inr=freight, cases=sum(l.cases for l in lines)),
                solve=SolveInfo(status=SolveStatus.NOT_SOLVED, seconds=round(seconds, 4), solver="baseline"),
                created_at=datetime.now(timezone.utc))


def positions(snapshot: Snapshot) -> dict[tuple[str, str], float]:
    """(dist, sku) -> on hand + in transit."""
    pos: dict[tuple[str, str], float] = defaultdict(float)
    for s in snapshot.dist_stock:
        pos[(s.dist_id, s.sku_id)] += s.qty_cases
    for t in snapshot.in_transit:
        pos[(t.to_id, t.sku_id)] += t.qty_cases
    return pos
