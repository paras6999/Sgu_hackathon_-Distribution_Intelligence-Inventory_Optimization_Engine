"""Shared baseline mechanics (owner: M2): lot picking, MRSL, storage/credit limits, trucks and freight.

Both baselines obey the same stock, truck, storage, credit and MRSL limits as the engine (FR-10).
Freight, truck packing and freight allocation come from dia_engine.optimize.freight, the same code
the engine uses, so every policy pays identical freight.
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from dia_engine.optimize import freight
from dia_types import (
    ExpectedKpis, LineStatus, Lot, Plan, PlanLine, PolicyName, Scenario, ShipMode, Sku, Snapshot, SolveInfo,
    SolveStatus, TempClass, TruckClass,
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


def cheaper_mode(load_fraction: float, ftl_cost: float, ptl_cost: float) -> bool:
    """Default lane rule (Baseline A): PTL when it costs less than the FTL trips the load needs."""
    return ptl_cost < ftl_cost


def build_plan(drafts: list[Draft], scenario: Scenario, as_of: date, temp_class: TempClass, policy: str,
               plan_id: str, seconds: float, use_ptl_rule=cheaper_mode) -> Plan:
    """Choose FTL vs PTL per lane (ambient only) with use_ptl_rule(load_fraction, ftl_cost, ptl_cost),
    then pack and price with optimize.freight. load_fraction = max(kg, m3 share) of one truck."""
    lanes = {(l.from_id, l.to_id): l for l in scenario.lanes}
    tc = freight.truck_class_for(temp_class)
    cap = freight.capacity(tc)

    by_lane: dict[tuple[str, str], list[Draft]] = defaultdict(list)
    for d in drafts:
        if d.cases > 0:
            by_lane[(d.lot.depot_id, d.to_id)].append(d)

    lines: list[PlanLine] = []
    trips: dict[tuple[str, str, TruckClass], int] = {}
    for (w, j), ds in sorted(by_lane.items()):
        lane = lanes[(w, j)]
        eta = as_of + timedelta(days=math.ceil(lane.lead_days_mean))
        kg = sum(d.cases * d.sku.kg_per_case for d in ds)
        m3 = sum(d.cases * d.sku.m3_per_case for d in ds)
        n_trips = freight.trips_needed(kg, m3, tc)
        ftl_cost = n_trips * freight.ftl_trip_cost(lane, tc, as_of)
        ptl_cost = freight.ptl_cost(lane, kg, m3, as_of)
        use_ptl = temp_class is TempClass.AMBIENT and use_ptl_rule(max(kg / cap.kg, m3 / cap.m3), ftl_cost, ptl_cost)
        trips[(w, j, tc)] = 0 if use_ptl else n_trips
        for d in ds:
            lines.append(PlanLine(
                line_id=f"{plan_id}-v1-{len(lines) + 1:03d}", sku_id=d.sku.sku_id, sku_name=d.sku.name,
                lot_id=d.lot.lot_id, expiry=d.lot.expiry_date, from_id=w, to_id=j, cases=d.cases,
                mode=ShipMode.PTL if use_ptl else ShipMode.FTL, ship_date=as_of, eta=eta,
                rsl_on_arrival_days=(d.lot.expiry_date - eta).days, freight_alloc_inr=0.0, reasons=[],
                status=LineStatus.PROPOSED))

    lines, trucks = freight.build_loads(lines, trips, scenario)
    cost = sum(t.cost_inr for t in trucks)
    return Plan(plan_id=plan_id, version=1, scenario_id=scenario.scenario_id, as_of=as_of, temp_class=temp_class,
                policy=PolicyName(policy), lines=lines, trucks=trucks,
                expected_kpis=ExpectedKpis(freight_inr=cost, total_inr=cost, cases=sum(l.cases for l in lines)),
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
