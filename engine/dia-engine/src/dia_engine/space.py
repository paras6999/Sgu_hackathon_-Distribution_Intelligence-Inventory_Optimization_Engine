"""Warehouse space (owner: M1). How full each depot store and distributor godown is on a morning, and what still fits.

A depot has two stores, ambient and a chilled cold room. Their capacity is `supply.depot_storage_weeks` times the
weekly volume of the depot's region (the same neutral-month base demand that sizes distributor godowns in
data/generate.py). A distributor godown is one space for all goods, `storage_m3`, and counts stock in transit as
taken, as the optimiser's storage constraint does. Display only: the simulator and optimiser do not read depot
capacity.
"""
from __future__ import annotations

import math
from collections import defaultdict

from dia_engine.config import get_config
from dia_engine.data.generate import _base_daily
from dia_types import NodeType, OpeningState, Scenario, Snapshot, SpaceFit, SpaceNode, SpaceReport


def depot_capacity_m3(scenario: Scenario) -> dict[tuple[str, str], float]:
    """(depot_id, temp_class) -> m3 of space for this company at that depot store."""
    cfg = get_config()
    m3 = {s.sku_id: s.m3_per_case for s in scenario.skus}
    temp = {s.sku_id: s.temp_class.value for s in scenario.skus}
    base = _base_daily(cfg)                                   # [sku, distributor] cases per day, config order
    weekly: dict[tuple[str, str], float] = defaultdict(float)
    home = {d.region: d.id for d in cfg.catalogue.depots}
    for i, sku in enumerate(cfg.catalogue.skus):
        for j, dist in enumerate(cfg.catalogue.distributors):
            weekly[(home[dist.region], temp[sku.id])] += base[i, j] * m3[sku.id] * 7
    return {k: v * cfg.supply.depot_storage_weeks[k[1]] for k, v in weekly.items()}


def _fits(free_m3: float, skus) -> list[SpaceFit]:
    return [SpaceFit(sku_id=s.sku_id, sku_name=s.name, cases=int(math.floor(free_m3 / s.m3_per_case + 1e-9)))
            for s in skus if s.m3_per_case > 0]


def _node(node, temp_class, capacity: float, used: float, cases: float, skus) -> SpaceNode:
    free = max(capacity - used, 0.0)
    return SpaceNode(
        node_type=node.type.value, node_id=node.node_id, city=node.city, region=node.region, temp_class=temp_class,
        capacity_m3=round(capacity, 1), used_m3=round(used, 1), free_m3=round(free, 1),
        used_pct=round(100 * used / capacity, 1) if capacity > 0 else 0.0, cases=round(cases, 1),
        fits=_fits(free, skus))


def space(scenario: Scenario, snapshot: Snapshot, opening_state: OpeningState) -> SpaceReport:
    skus = {s.sku_id: s for s in scenario.skus}
    by_temp = {t: [s for s in scenario.skus if s.temp_class.value == t] for t in ("ambient", "chilled")}
    cap = depot_capacity_m3(scenario)

    used: dict[tuple[str, str], float] = defaultdict(float)
    cases: dict[tuple[str, str], float] = defaultdict(float)
    for l in snapshot.depot_lots:
        s = skus[l.sku_id]
        used[(l.depot_id, s.temp_class.value)] += l.qty_cases * s.m3_per_case
        cases[(l.depot_id, s.temp_class.value)] += l.qty_cases
    held: dict[str, float] = defaultdict(float)
    held_cases: dict[str, float] = defaultdict(float)
    for d in snapshot.dist_stock:
        held[d.dist_id] += d.qty_cases * skus[d.sku_id].m3_per_case
        held_cases[d.dist_id] += d.qty_cases
    for t in snapshot.in_transit:
        held[t.to_id] += t.qty_cases * skus[t.sku_id].m3_per_case
        held_cases[t.to_id] += t.qty_cases

    depots = [_node(n, t, cap.get((n.node_id, t), 0.0), used[(n.node_id, t)], cases[(n.node_id, t)], by_temp[t])
              for n in scenario.nodes if n.type == NodeType.DEPOT for t in ("ambient", "chilled")]
    dists = [_node(n, None, n.storage_m3 or 0.0, held[n.node_id], held_cases[n.node_id], scenario.skus)
             for n in scenario.nodes if n.type == NodeType.DISTRIBUTOR]
    return SpaceReport(scenario_id=snapshot.scenario_id, as_of=snapshot.as_of, opening_state=opening_state,
                       depots=depots, distributors=dists)
