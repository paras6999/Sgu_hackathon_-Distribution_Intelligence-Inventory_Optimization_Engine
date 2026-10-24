"""FR-04 Order-up-to targets (owner: M2). Reported to planners; NOT imposed by the optimiser. PRD 6.6.2.

  S  = mu(R+L) + z(CR) x sigma(R+L)
  CR = Cu / (Cu + Co), clipped to planning.critical_ratio_clip
  Cu = stockout_penalty_x_margin x margin
  Co = holding over the review period + P(expire before sale) x (landed + disposal) x claim share

R = planning cadence (ambient 7 d, chilled 2 d); L = mean lead time from the distributor's home depot.
Ambient windows extend to the end of a festival week (factor >= min_factor) starting within
lookahead_days of the normal window (A26); chilled never pre-builds.

P(expire before sale) is approximated as cover_days / RSL on arrival (the share of remaining life one
cover window uses up), with RSL on arrival = shelf life x (1 - mean life used at receipt) - L.
Judgment: the exact newsvendor term is ~0 for every SKU at our cadences, which would leave chilled
SKUs with a higher service level than ambient ones, the opposite of PRD F4 / FR-04 acceptance.
"""
from __future__ import annotations

import math
from datetime import timedelta

from scipy.stats import norm

from dia_engine.config import get_config
from dia_engine.forecast.dist import window
from dia_types import EngineSettings, ForecastBundle, PairForecast, Scenario, Target, TempClass

UNIFORM_CR = 0.95   # ablation (e): one service level for every SKU, matching Baseline B


def cover_days(pf: PairForecast, temp_class: TempClass, lead_days: float) -> int:
    """R + L, extended to the end of an upcoming festival week for ambient SKUs."""
    cfg = get_config().planning
    base = cfg.cadence_days[temp_class.value] + math.ceil(lead_days)
    look = cfg.festival_prebuild.lookahead_days.get(temp_class.value, 0)
    if look <= 0:
        return base
    horizon = len(pf.festival)
    for i in range(base, min(base + look, horizon)):
        if pf.festival[i] >= cfg.festival_prebuild.min_factor:
            end = i
            while end + 1 < horizon and pf.festival[end + 1] >= cfg.festival_prebuild.min_factor:
                end += 1
            sunday = end + (6 - (pf.start + timedelta(days=end)).weekday())
            return min(sunday + 1, horizon)
    return base


def critical_ratio(sku, temp_class: TempClass, cover: int, lead_days: float, review_days: int) -> float:
    cfg = get_config()
    lo, hi = cfg.planning.critical_ratio_clip
    cu = cfg.costs.stockout_penalty_x_margin * sku.margin_inr
    used = cfg.supply.life_used_at_receipt
    used_days = (sum(used.chilled_days) / 2 if temp_class is TempClass.CHILLED
                 else sku.shelf_life_days * sum(used.ambient) / 2)
    rsl_arrival = max(sku.shelf_life_days - used_days - lead_days, 1.0)
    p_expire = min(cover / rsl_arrival, 1.0)
    holding = cfg.costs.holding_rate_annual * sku.landed_cost_inr * review_days / 365
    co = holding + p_expire * (sku.landed_cost_inr + sku.disposal_inr) * cfg.costs.expiry_claim_share
    return min(max(cu / (cu + co), lo), hi)


def compute_targets(scenario: Scenario, forecast: ForecastBundle, temp_class: TempClass,
                    settings: EngineSettings | None = None) -> list[Target]:
    """S per SKU x distributor of this temperature class (FR-04)."""
    settings = settings or EngineSettings()
    review = get_config().planning.cadence_days[temp_class.value]
    skus = {s.sku_id: s for s in scenario.skus if s.temp_class == temp_class}
    home = {n.node_id: n.home_depot_id for n in scenario.nodes}
    lead = {(l.from_id, l.to_id): l.lead_days_mean for l in scenario.lanes}
    out: list[Target] = []
    for pf in forecast.pairs:
        sku = skus.get(pf.sku_id)
        if sku is None:
            continue
        lt = lead.get((home.get(pf.dist_id), pf.dist_id), 1.0)
        cover = cover_days(pf, temp_class, lt)
        mu, var = window(pf, pf.start, cover)
        sigma = math.sqrt(max(var, 0.0))
        cr = UNIFORM_CR if settings.uniform_service_level else critical_ratio(sku, temp_class, cover, lt, review)
        z = float(norm.ppf(cr))
        out.append(Target(sku_id=pf.sku_id, dist_id=pf.dist_id, S=max(mu + z * sigma, 0.0), critical_ratio=cr,
                          z=z, cover_days=cover, mu=mu, sigma=sigma))
    return out
