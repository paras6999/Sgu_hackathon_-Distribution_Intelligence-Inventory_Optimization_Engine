"""Freight costs and load build, PRD 6.5 step 7 and A11-A14.

Shared by the engine AND both baselines so every policy pays identical freight.

* FTL trip: the lane's trip cost for the truck class (A11/A12, computed by the generator from the
  diesel price) x festival premium in the premium months (A14).
* PTL: max(minimum charge, slab rate x chargeable kg), chargeable kg = max(kg, kg_per_m3 x m3) (A13).
  Ambient only; chilled always rides reefer FTL.
* Load build: whole cases, first-fit decreasing by each line's share of a truck, splitting a line
  across trucks when needed. The lane gets the trips it was given; if whole-case packing needs one
  more, a truck is added (the cost reflects the trucks actually used). Unused trips are dropped.
* Freight allocation: a truck's cost split by each line's share max(kg / cap kg, m3 / cap m3);
  a PTL consignment's charge split by chargeable kg.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date

from dia_engine.config import FtlClass, get_config
from dia_types import Lane, PlanLine, Scenario, ShipMode, Sku, TempClass, Truck, TruckClass

EPS = 1e-9


def festival_premium(ship_date: date) -> float:
    p = get_config().costs.festival_freight_premium
    return p.factor if ship_date.month in p.months else 1.0


def truck_class_for(temp_class: TempClass | str) -> TruckClass:
    return TruckClass.REEF17 if TempClass(temp_class) is TempClass.CHILLED else TruckClass.AMB32


def capacity(truck_class: TruckClass) -> FtlClass:
    return get_config().costs.ftl[truck_class.value]


def ftl_trip_cost(lane: Lane, truck_class: TruckClass, ship_date: date) -> float:
    """Trip cost including the festival premium (config costs.festival_freight_premium)."""
    return lane.ftl_cost_inr[truck_class.value] * festival_premium(ship_date)


def ptl_cost(lane: Lane, kg: float, m3: float, ship_date: date) -> float:
    """max(min charge, rate x chargeable kg), chargeable kg = max(kg, kg_per_m3 x m3)."""
    if kg <= 0 and m3 <= 0:
        return 0.0
    chargeable = max(kg, get_config().costs.ptl.kg_per_m3 * m3)
    return max(lane.ptl_min_charge_inr, lane.ptl_rate_inr_per_kg * chargeable)


def trips_needed(kg: float, m3: float, truck_class: TruckClass) -> int:
    """Trucks for a divisible load (whole-case packing may need one more; build_loads adds it)."""
    cap = capacity(truck_class)
    return math.ceil(max(kg / cap.kg, m3 / cap.m3) - EPS) if (kg > 0 or m3 > 0) else 0


def _code(node_id: str) -> str:
    return node_id.split("-")[0]


def build_loads(lines: list[PlanLine], ftl_trips: dict[tuple[str, str, TruckClass], int],
                scenario: Scenario) -> tuple[list[PlanLine], list[Truck]]:
    """Assign lines to trucks, set truck_id / consignment_id, truck_class, mode and freight_alloc_inr.

    ftl_trips[(from, to, class)] = integer FTL trips for the lane; 0 or missing means PTL for ambient.
    Returns (lines, trucks). Lines may be split across trucks; output line ids are renumbered in
    lane order with the input ids' common prefix (e.g. "PL-ABC123-v1-007").
    """
    skus = {s.sku_id: s for s in scenario.skus}
    lanes = {(l.from_id, l.to_id): l for l in scenario.lanes}
    kg_per_m3 = get_config().costs.ptl.kg_per_m3
    groups: dict[tuple[str, str, TruckClass], list[PlanLine]] = defaultdict(list)
    for line in lines:
        if line.cases > 0:
            groups[(line.from_id, line.to_id, truck_class_for(skus[line.sku_id].temp_class))].append(line)

    prefix = lines[0].line_id.rsplit("-", 1)[0] if lines else "PL"
    out_lines: list[PlanLine] = []
    trucks: list[Truck] = []

    for (w, j, tc), group in sorted(groups.items(), key=lambda kv: (kv[0][0], kv[0][1], kv[0][2].value)):
        lane = lanes[(w, j)]
        ship_date = group[0].ship_date
        cap = capacity(tc)
        trips = ftl_trips.get((w, j, tc), 0)
        if tc is TruckClass.REEF17 and trips <= 0:
            trips = trips_needed(sum(l.cases * skus[l.sku_id].kg_per_case for l in group),
                                 sum(l.cases * skus[l.sku_id].m3_per_case for l in group), tc)

        if trips <= 0:   # ambient PTL consignment
            loads = [[(l, l.cases) for l in group]]
            kg = sum(l.cases * skus[l.sku_id].kg_per_case for l in group)
            m3 = sum(l.cases * skus[l.sku_id].m3_per_case for l in group)
            costs = [ptl_cost(lane, kg, m3, ship_date)]
            ids = [f"C-{_code(w)}-{_code(j)}-01"]
            mode = ShipMode.PTL
        else:
            loads = _pack(group, skus, cap, trips)
            costs = [ftl_trip_cost(lane, tc, ship_date)] * len(loads)
            ids = [f"T-{_code(w)}-{_code(j)}-{k + 1:02d}" for k in range(len(loads))]
            mode = ShipMode.FTL

        for load, cost, truck_id in zip(loads, costs, ids):
            sku_of = lambda l: skus[l.sku_id]  # noqa: E731
            if mode is ShipMode.FTL:
                shares = [max(n * sku_of(l).kg_per_case / cap.kg, n * sku_of(l).m3_per_case / cap.m3) for l, n in load]
            else:
                shares = [n * max(sku_of(l).kg_per_case, kg_per_m3 * sku_of(l).m3_per_case) for l, n in load]
            total = sum(shares) or 1.0
            line_ids = []
            for (l, n), sh in zip(load, shares):
                line_id = f"{prefix}-{len(out_lines) + 1:03d}"
                line_ids.append(line_id)
                out_lines.append(l.model_copy(update={
                    "line_id": line_id, "cases": n, "mode": mode,
                    "truck_id": truck_id if mode is ShipMode.FTL else None,
                    "consignment_id": truck_id if mode is ShipMode.PTL else None,
                    "truck_class": tc if mode is ShipMode.FTL else None,
                    "freight_alloc_inr": round(cost * sh / total, 2)}))
            t_kg = sum(n * sku_of(l).kg_per_case for l, n in load)
            t_m3 = sum(n * sku_of(l).m3_per_case for l, n in load)
            trucks.append(Truck(
                truck_id=truck_id, mode=mode, truck_class=tc if mode is ShipMode.FTL else None,
                from_id=w, to_id=j, ship_date=ship_date, kg=round(t_kg, 3), m3=round(t_m3, 4),
                kg_pct=round(100 * t_kg / cap.kg, 2) if mode is ShipMode.FTL else 0.0,
                m3_pct=round(100 * t_m3 / cap.m3, 2) if mode is ShipMode.FTL else 0.0,
                cost_inr=round(cost, 2), line_ids=line_ids))
    return out_lines, trucks


def _pack(group: list[PlanLine], skus: dict[str, Sku], cap: FtlClass, trips: int) -> list[list[tuple[PlanLine, int]]]:
    """First-fit decreasing of whole cases into `trips` trucks, adding trucks if cases do not fit."""
    order = sorted(group, key=lambda l: (-max(l.cases * skus[l.sku_id].kg_per_case / cap.kg,
                                              l.cases * skus[l.sku_id].m3_per_case / cap.m3), l.line_id))
    room = [[cap.kg, cap.m3] for _ in range(trips)]
    loads: list[list[tuple[PlanLine, int]]] = [[] for _ in range(trips)]
    for line in order:
        sku = skus[line.sku_id]
        left = line.cases
        k = 0
        while left > 0:
            if k == len(room):
                room.append([cap.kg, cap.m3])
                loads.append([])
            fit = min(left, int((room[k][0] + EPS) // sku.kg_per_case), int((room[k][1] + EPS) // sku.m3_per_case))
            if fit > 0:
                loads[k].append((line, fit))
                room[k][0] -= fit * sku.kg_per_case
                room[k][1] -= fit * sku.m3_per_case
                left -= fit
            elif not loads[k] and room[k] == [cap.kg, cap.m3]:
                raise ValueError(f"one case of {line.sku_id} does not fit an empty truck")
            k += 1
    return [load for load in loads if load]
