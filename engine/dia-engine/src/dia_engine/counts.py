"""Counted stock (warehouse app). A count replaces the simulated quantity of one product at one node.

The snapshot is simulated; a count is what someone found on the shelf. For each (node, product) counted:
- lots that exist are scaled so they add up to the count, keeping their expiry dates (oldest stock stays oldest);
- if the system shows none but the shelf has some, one lot is added with the product's median remaining life
  across the network's lots of that product (or 60% of shelf life when there are none), marked lot_id "COUNTED-...".
A distributor's stock in transit is left alone: it has not arrived, so it cannot have been counted.
"""
from __future__ import annotations

from datetime import date, timedelta
from statistics import median

from dia_types import DistStock, Lot, NodeType, Scenario, Snapshot, StockCount

FALLBACK_LIFE_LEFT = 0.6     # share of shelf life assumed for counted stock the system did not know about


def _remaining_days(snapshot: Snapshot, sku_id: str, shelf_life: int) -> int:
    lefts = [(l.expiry_date - snapshot.as_of).days for l in snapshot.depot_lots if l.sku_id == sku_id]
    lefts += [(d.expiry_date - snapshot.as_of).days for d in snapshot.dist_stock if d.sku_id == sku_id]
    lefts = [x for x in lefts if x > 0]
    return int(median(lefts)) if lefts else max(1, round(FALLBACK_LIFE_LEFT * shelf_life))


def _scaled(qtys: list[float], total: float) -> list[float]:
    have = sum(qtys)
    return [q * total / have for q in qtys] if have > 0 else qtys


def apply_counts(scenario: Scenario, snapshot: Snapshot, counts: list[StockCount]) -> Snapshot:
    if not counts:
        return snapshot
    nodes = {n.node_id: n for n in scenario.nodes}
    skus = {s.sku_id: s for s in scenario.skus}
    latest = {(c.node_id, c.sku_id): float(c.cases) for c in counts}      # last count per pair wins
    depot_lots = list(snapshot.depot_lots)
    dist_stock = list(snapshot.dist_stock)
    for (node_id, sku_id), cases in latest.items():
        node, sku = nodes.get(node_id), skus.get(sku_id)
        if node is None or sku is None:
            raise ValueError(f"unknown node or product in stock count: {node_id}, {sku_id}")
        expiry = snapshot.as_of + timedelta(days=_remaining_days(snapshot, sku_id, sku.shelf_life_days))
        if node.type == NodeType.DEPOT:
            mine = [i for i, l in enumerate(depot_lots) if l.depot_id == node_id and l.sku_id == sku_id]
            if mine and sum(depot_lots[i].qty_cases for i in mine) > 0:
                for i, q in zip(mine, _scaled([depot_lots[i].qty_cases for i in mine], cases)):
                    depot_lots[i] = depot_lots[i].model_copy(update={"qty_cases": q})
            elif cases > 0:
                depot_lots.append(Lot(lot_id=f"COUNTED-{node_id}-{sku_id}", sku_id=sku_id, depot_id=node_id, qty_cases=cases,
                                      mfg_date=expiry - timedelta(days=sku.shelf_life_days), expiry_date=expiry))
        else:
            mine = [i for i, d in enumerate(dist_stock) if d.dist_id == node_id and d.sku_id == sku_id]
            if mine and sum(dist_stock[i].qty_cases for i in mine) > 0:
                for i, q in zip(mine, _scaled([dist_stock[i].qty_cases for i in mine], cases)):
                    dist_stock[i] = dist_stock[i].model_copy(update={"qty_cases": q})
            elif cases > 0:
                dist_stock.append(DistStock(dist_id=node_id, sku_id=sku_id, lot_id=f"COUNTED-{node_id}-{sku_id}",
                                            qty_cases=cases, expiry_date=expiry))
    depot_lots = [l for l in depot_lots if l.qty_cases > 0]
    dist_stock = [d for d in dist_stock if d.qty_cases > 0]
    # storage still free after the counts (the optimiser's godown limit reads this)
    held = {n.node_id: 0.0 for n in scenario.nodes if n.type == NodeType.DISTRIBUTOR}
    for d in dist_stock:
        held[d.dist_id] = held.get(d.dist_id, 0.0) + d.qty_cases * skus[d.sku_id].m3_per_case
    for t in snapshot.in_transit:
        held[t.to_id] = held.get(t.to_id, 0.0) + t.qty_cases * skus[t.sku_id].m3_per_case
    free = {j: max((nodes[j].storage_m3 or 0.0) - held.get(j, 0.0), 0.0) for j in snapshot.storage_free_m3}
    return snapshot.model_copy(update={"depot_lots": depot_lots, "dist_stock": dist_stock, "storage_free_m3": free})
