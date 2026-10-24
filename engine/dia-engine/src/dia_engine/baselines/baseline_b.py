"""FR-10 Baseline B, nearest-depot (s, S) reorder with FTL rounding (owner: M2).

* (s, S) on the engine's forecast at one service level (95% by default):
    s = mu(L) + z sigma(L)            reorder point: lead-time demand
    S = mu(R + L) + z sigma(R + L)    order-up-to level
  A distributor orders S - position when its position (on hand + in transit) is below s.
* Orders are served first-come-first-served in a seed-randomised order, each from the nearest depot
  (road km) that holds usable stock (MRSL), FEFO issue. One depot per order; shortfalls stay unmet.
* Storage and credit cut lines pro rata (same rule as every policy).
* FTL rounding: a lane load of at least 70% of the last truck is topped up to full with the
  distributor's highest-velocity SKUs from the same depot (each capped at one more review period of
  demand, and within storage and credit headroom). Lane loads under 70% of one truck go PTL; chilled
  always rides reefer FTL.
"""
from __future__ import annotations

import math
import time
from collections import defaultdict

import numpy as np
from scipy.stats import norm

from dia_engine.baselines.common import Draft, apply_limits, build_plan, mrsl_ok, positions, take_lots
from dia_engine.config import get_config
from dia_engine.optimize import freight
from dia_engine.forecast.dist import window
from dia_types import ForecastBundle, Plan, Scenario, Snapshot, TempClass

TOP_UP_THRESHOLD = 0.70


class BaselineB:
    name = "baseline_b"

    def __init__(self, service_level: float = 0.95, seed: int = 0):
        self.service_level = service_level
        self.seed = seed

    def plan(self, scenario: Scenario, snapshot: Snapshot, forecast: ForecastBundle, temp_class: TempClass) -> Plan:
        t0 = time.perf_counter()
        cfg = get_config()
        mrsl = cfg.planning.mrsl_fraction["GT"]
        review = cfg.planning.cadence_days[temp_class.value]
        z = float(norm.ppf(self.service_level))
        skus = {s.sku_id: s for s in scenario.skus if s.temp_class == temp_class}
        lanes = {(l.from_id, l.to_id): l for l in scenario.lanes}
        depots_by_km: dict[str, list[str]] = defaultdict(list)
        for l in sorted(scenario.lanes, key=lambda l: (l.km, l.from_id)):
            depots_by_km[l.to_id].append(l.from_id)
        pairs = {(p.sku_id, p.dist_id): p for p in forecast.pairs if p.sku_id in skus}
        pos = positions(snapshot)
        remaining = {l.lot_id: l.qty_cases for l in snapshot.depot_lots}
        lots_at: dict[tuple[str, str], list] = defaultdict(list)
        for l in snapshot.depot_lots:
            if l.sku_id in skus:
                lots_at[(l.depot_id, l.sku_id)].append(l)

        def usable(depot: str, sku_id: str, dist: str):
            lead = lanes[(depot, dist)].lead_days_mean
            return [l for l in lots_at[(depot, sku_id)]
                    if remaining[l.lot_id] >= 1 and mrsl_ok(skus[sku_id], l, snapshot.as_of, lead, mrsl)]

        # first-come-first-served, seed-randomised per cycle
        dists = sorted({j for (_, j) in pairs})
        rng = np.random.default_rng(self.seed * 1_000_003 + snapshot.as_of.toordinal())
        order = [dists[i] for i in rng.permutation(len(dists))]

        drafts: list[Draft] = []
        for j in order:
            nearest = depots_by_km[j][0]
            lead = math.ceil(lanes[(nearest, j)].lead_days_mean)
            for sku_id in sorted(s for (s, d) in pairs if d == j):
                pf = pairs[(sku_id, j)]
                mu_l, var_l = window(pf, pf.start, max(lead, 1))
                mu_rl, var_rl = window(pf, pf.start, review + lead)
                s_point = mu_l + z * math.sqrt(var_l)
                big_s = mu_rl + z * math.sqrt(var_rl)
                if pos[(j, sku_id)] >= s_point:
                    continue
                qty = math.ceil(big_s - pos[(j, sku_id)])
                depot = next((w for w in depots_by_km[j] if usable(w, sku_id, j)), None)
                if depot is None or qty <= 0:
                    continue
                for lot, n in take_lots(usable(depot, sku_id, j), remaining, qty, fefo=True):
                    drafts.append(Draft(skus[sku_id], lot, j, n))

        drafts = apply_limits(drafts, snapshot)
        drafts = self._top_up(drafts, snapshot, pairs, skus, usable, remaining, temp_class, review)
        return build_plan(drafts, scenario, snapshot.as_of, temp_class, self.name,
                          f"BLB-{snapshot.as_of:%Y%m%d}-{temp_class.value}", time.perf_counter() - t0,
                          use_ptl_rule=lambda load_fraction, ftl, ptl: load_fraction < TOP_UP_THRESHOLD)

    def _top_up(self, drafts, snapshot, pairs, skus, usable, remaining, temp_class, review) -> list[Draft]:
        cap = freight.capacity(freight.truck_class_for(temp_class))
        lanes: dict[tuple[str, str], list[Draft]] = defaultdict(list)
        for d in drafts:
            lanes[(d.lot.depot_id, d.to_id)].append(d)
        m3_used, inr_used = defaultdict(float), defaultdict(float)
        for d in drafts:
            m3_used[d.to_id] += d.cases * d.sku.m3_per_case
            inr_used[d.to_id] += d.cases * d.sku.price_inr

        out = list(drafts)
        for (w, j), ds in sorted(lanes.items()):
            kg = sum(d.cases * d.sku.kg_per_case for d in ds)
            m3 = sum(d.cases * d.sku.m3_per_case for d in ds)
            load = max(kg / cap.kg, m3 / cap.m3)
            last = load - math.floor(load)
            if load < TOP_UP_THRESHOLD or last < TOP_UP_THRESHOLD or last == 0:
                continue
            kg_room = math.ceil(load) * cap.kg - kg
            m3_room = math.ceil(load) * cap.m3 - m3
            velocity = sorted(((sum(pairs[(s, j)].mean[:7]) / 7, s) for (s, d) in pairs if d == j), reverse=True)
            for daily, sku_id in velocity:
                sku = skus[sku_id]
                m3_head = snapshot.storage_free_m3.get(j, math.inf) - m3_used[j]
                inr_head = snapshot.credit_available_inr.get(j, math.inf) - inr_used[j]
                n = min(int(kg_room // sku.kg_per_case), int(m3_room // sku.m3_per_case),
                        int(m3_head // sku.m3_per_case), int(inr_head // sku.price_inr), math.ceil(daily * review))
                if n <= 0:
                    continue
                for lot, k in take_lots(usable(w, sku_id, j), remaining, n, fefo=True):
                    out.append(Draft(sku, lot, j, k))
                    kg_room -= k * sku.kg_per_case
                    m3_room -= k * sku.m3_per_case
                    m3_used[j] += k * sku.m3_per_case
                    inr_used[j] += k * sku.price_inr
        return out
