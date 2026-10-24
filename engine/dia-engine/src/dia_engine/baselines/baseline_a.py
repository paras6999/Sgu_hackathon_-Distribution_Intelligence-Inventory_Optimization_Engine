"""FR-10 Baseline A, proportional fair share (owner: M2).

Each depot splits its stock of a SKU across its home-region distributors in proportion to their demand,
capping each at `cover_days` of forecast demand minus stock already there or in transit. FIFO issue
(oldest manufacture first), MRSL respected. Each lane ships by whichever of FTL or PTL is cheaper.
Storage and credit cut lines pro rata, exactly as for every other policy.

Weights: the PRD says trailing 4-week sales, but the Policy contract carries only the snapshot and
the engine's forecast, so the forecast demand over the cover window stands in (both baselines use the
engine's forecast). TODO(contract): add trailing sales to Snapshot if M1 wants the literal rule.
"""
from __future__ import annotations

import time
from collections import defaultdict

from dia_engine.baselines.common import Draft, apply_limits, build_plan, mrsl_ok, positions, take_lots
from dia_engine.config import get_config
from dia_types import ForecastBundle, Plan, Scenario, Snapshot, TempClass


class BaselineA:
    name = "baseline_a"

    def __init__(self, cover_days: int = 14):
        self.cover_days = cover_days

    def plan(self, scenario: Scenario, snapshot: Snapshot, forecast: ForecastBundle, temp_class: TempClass) -> Plan:
        t0 = time.perf_counter()
        mrsl = get_config().planning.mrsl_fraction["GT"]
        skus = {s.sku_id: s for s in scenario.skus if s.temp_class == temp_class}
        nodes = {n.node_id: n for n in scenario.nodes}
        lanes = {(l.from_id, l.to_id): l for l in scenario.lanes}
        pos = positions(snapshot)
        demand = {(p.sku_id, p.dist_id): sum(p.mean[: self.cover_days]) for p in forecast.pairs if p.sku_id in skus}

        remaining = {l.lot_id: l.qty_cases for l in snapshot.depot_lots}
        lots_at: dict[tuple[str, str], list] = defaultdict(list)
        for l in snapshot.depot_lots:
            if l.sku_id in skus:
                lots_at[(l.depot_id, l.sku_id)].append(l)

        drafts: list[Draft] = []
        for (depot, sku_id), lots in sorted(lots_at.items()):
            sku = skus[sku_id]
            dists = sorted(j for (s, j) in demand if s == sku_id and nodes[j].home_depot_id == depot)
            usable = {j: [l for l in lots if mrsl_ok(sku, l, snapshot.as_of, lanes[(depot, j)].lead_days_mean, mrsl)]
                      for j in dists}
            need = {j: max(0.0, demand[(sku_id, j)] - pos[(j, sku_id)]) for j in dists}
            avail = sum(remaining[i] for i in {l.lot_id for ls in usable.values() for l in ls})
            alloc = _fair_share(avail, {j: demand[(sku_id, j)] for j in dists}, need)
            for j in dists:
                for lot, n in take_lots(usable[j], remaining, int(alloc[j]), fefo=False):
                    drafts.append(Draft(sku, lot, j, n))

        drafts = apply_limits(drafts, snapshot)
        return build_plan(drafts, scenario, snapshot.as_of, temp_class, self.name,
                          f"BLA-{snapshot.as_of:%Y%m%d}-{temp_class.value}", time.perf_counter() - t0)


def _fair_share(avail: float, weight: dict[str, float], need: dict[str, float]) -> dict[str, float]:
    """Split avail in proportion to weight, capped at need; capped surplus is re-split among the rest."""
    alloc = {j: 0.0 for j in weight}
    open_ = {j for j in weight if need[j] > 0 and weight[j] > 0}
    left = avail
    while left > 1e-9 and open_:
        total = sum(weight[j] for j in open_)
        spent = 0.0
        for j in sorted(open_):
            give = min(left * weight[j] / total, need[j] - alloc[j])
            alloc[j] += give
            spent += give
        left -= spent
        open_ = {j for j in open_ if need[j] - alloc[j] > 1e-9}
        if spent <= 1e-9:
            break
    return alloc
