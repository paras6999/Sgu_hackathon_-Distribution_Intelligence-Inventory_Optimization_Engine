"""FR-09 Simulation harness, PRD 6.6.5 (owner: M1)."""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, timedelta
from typing import Callable

import pandas as pd

from dia_engine.baselines.baseline_a import BaselineA
from dia_engine.baselines.baseline_b import BaselineB
from dia_engine import store
from dia_engine.config import get_config
from dia_engine.data.generate import load_scenario
from dia_engine.forecast.forecast import forecast
from dia_engine.forecast.dist import window
from dia_types import (
    DistStock, EngineSettings, ExperimentRequest, ForecastMode, Lot, NodeType, OpeningState, Snapshot, TempClass,
)
from dia_engine.optimize.pipeline import EnginePolicy
from dia_engine.sim.policy import Policy

# Ablation and policy switches (FR-12). Contract: names match dia_types.PolicyName.
POLICY_SETTINGS: dict[str, EngineSettings] = {
    "engine": EngineSettings(),
    "abl_no_expiry": EngineSettings(no_expiry_term=True),
    "abl_no_truck_steps": EngineSettings(no_truck_steps=True),
    "abl_naive_forecast": EngineSettings(forecast_model=ForecastMode.SEASONAL_NAIVE),
    "abl_no_credit": EngineSettings(no_credit=True),
    "abl_uniform_service": EngineSettings(uniform_service_level=True),
    "abl_home_depot": EngineSettings(home_depot_only=True),
}


def make_policy(name: str, seed: int) -> Policy:
    if name == "baseline_a":
        return BaselineA()
    if name == "baseline_b":
        return BaselineB(seed=seed)
    return EnginePolicy(name, POLICY_SETTINGS[name])


# Imbalanced opening state (FR-09, A24). Placement is deliberate: three different regions so the three
# stresses do not mask one another. Fractions come from the PRD, cover figures from the supply config.
AGED_DEPOT_REGION = "S"                  # depot holding snack lots near the MRSL floor
AGED_RSL_FRACTION = (0.62, 0.70)         # remaining life, just above the 0.60 MRSL (PRD FR-09)
SHORT_REGION = "N"                       # region short of festival-uplifted SKUs before Diwali
SHORT_COVER_DAYS = 2                     # days of forecast demand left on the shelf there
OVERSTOCK_REGION = "W"                   # its smallest distributor is overstocked on slow SKUs
SLOW_SKU_SHARE = 0.25                    # slowest quarter of that distributor's SKUs by forecast


def _stock_expiry(sku, cover: int, as_of: date) -> date:
    """Typical distributor lot: received at the configured share of life used, half a cover period ago."""
    used = get_config().supply.life_used_at_receipt
    life_used = (sum(used.chilled_days) / 2 if sku.temp_class == TempClass.CHILLED
                 else sku.shelf_life_days * sum(used.ambient) / 2)
    return as_of + timedelta(days=max(int(sku.shelf_life_days - life_used - cover / 2), 1))


def get_snapshot(scenario_id: str, as_of: date, opening_state: OpeningState = OpeningState.IMBALANCED) -> Snapshot:
    """State on as_of. On the first test day this is the opening state; later days replay the engine policy."""
    cfg = get_config()
    t0 = cfg.simulation.test_window[0]
    if as_of != t0:
        raise NotImplementedError(f"FR-09: only the first test day ({t0}) has a snapshot until run_policy exists")
    scenario = load_scenario(scenario_id)
    skus = {s.sku_id: s for s in scenario.skus}
    dists = [n for n in scenario.nodes if n.type == NodeType.DISTRIBUTOR]
    lots = [Lot(**r) for r in store.read_table("lots", scenario_id).to_dict("records")]
    fc = forecast(scenario_id, as_of)
    home = {n.node_id: n.home_depot_id for n in scenario.nodes}
    lead = {(l.from_id, l.to_id): l.lead_days_mean for l in scenario.lanes}
    cadence = cfg.planning.cadence_days

    # neutral: every distributor holds forecast demand over its regular cover (R + L) for each SKU.
    # The festival pre-build extension is left out: it is the engine's job and would fill the godown.
    cover = {(pf.sku_id, pf.dist_id): cadence[skus[pf.sku_id].temp_class.value]
             + math.ceil(lead.get((home[pf.dist_id], pf.dist_id), 1.0)) for pf in fc.pairs}
    stock = {(pf.sku_id, pf.dist_id): window(pf, pf.start, cover[(pf.sku_id, pf.dist_id)])[0] for pf in fc.pairs}
    if opening_state == OpeningState.IMBALANCED:
        lots = _age_snack_lots(lots, skus, scenario, as_of)
        _make_short(stock, fc, skus, scenario)
        _overstock_slow(stock, fc, scenario)

    dist_stock = [DistStock(dist_id=j, sku_id=i, qty_cases=float(round(q)),
                            expiry_date=_stock_expiry(skus[i], cover[(i, j)], as_of))
                  for (i, j), q in sorted(stock.items(), key=lambda kv: (kv[0][1], kv[0][0])) if round(q) > 0]

    held_m3: dict[str, float] = defaultdict(float)
    for d in dist_stock:
        held_m3[d.dist_id] += d.qty_cases * skus[d.sku_id].m3_per_case
    # invoices stay outstanding until payment_lag_days after sale: the last week's sales at invoice value
    demand = store.read_table("demand_daily", scenario_id)
    lag = cfg.simulation.payment_lag_days
    recent = demand[(demand["date"] >= as_of - timedelta(days=lag)) & (demand["date"] < as_of)]
    price = recent["sku_id"].map({k: v.price_inr for k, v in skus.items()})
    owed = (recent["sold"] * price).groupby(recent["dist_id"]).sum()
    credit = {n.node_id: float(max(n.credit_limit_inr - owed.get(n.node_id, 0.0), 0.0)) for n in dists}
    free = {n.node_id: float(max(n.storage_m3 - held_m3[n.node_id], 0.0)) for n in dists}
    return Snapshot(scenario_id=scenario_id, as_of=as_of, depot_lots=lots, dist_stock=dist_stock, in_transit=[],
                    credit_available_inr=credit, storage_free_m3=free)


def _age_snack_lots(lots: list[Lot], skus: dict, scenario, as_of: date) -> list[Lot]:
    depot = next(n.node_id for n in scenario.nodes if n.type == NodeType.DEPOT and n.region == AGED_DEPOT_REGION)
    idx = [k for k, l in enumerate(lots) if l.depot_id == depot and skus[l.sku_id].category == "snacks"]
    lo, hi = AGED_RSL_FRACTION
    out = list(lots)
    for n, k in enumerate(idx):
        life = skus[lots[k].sku_id].shelf_life_days
        frac = lo + (hi - lo) * (n / max(len(idx) - 1, 1))
        expiry = as_of + timedelta(days=round(frac * life))
        out[k] = lots[k].model_copy(update={"expiry_date": expiry, "mfg_date": expiry - timedelta(days=life)})
    return out


def _make_short(stock: dict, fc, skus: dict, scenario) -> None:
    """Festival-uplifted SKUs in SHORT_REGION: only SHORT_COVER_DAYS of forecast demand on hand."""
    members = {n.node_id for n in scenario.nodes if n.type == NodeType.DISTRIBUTOR and n.region == SHORT_REGION}
    uplifted = {c for f in get_config().calendar.festivals if f.name == "Diwali" and SHORT_REGION in f.regions
                for c in f.uplift}
    for pf in fc.pairs:
        if pf.dist_id in members and skus[pf.sku_id].category in uplifted:
            key = (pf.sku_id, pf.dist_id)
            stock[key] = min(stock[key], sum(pf.mean[:SHORT_COVER_DAYS]))


def _overstock_slow(stock: dict, fc, scenario) -> None:
    """Smallest distributor of OVERSTOCK_REGION holds the godown's full storage allowance of its slowest SKUs."""
    pop = {d.id: d.population_m for d in get_config().catalogue.distributors}
    dist = min((n.node_id for n in scenario.nodes if n.type == NodeType.DISTRIBUTOR and n.region == OVERSTOCK_REGION),
               key=lambda j: pop[j])
    mine = sorted((pf for pf in fc.pairs if pf.dist_id == dist), key=lambda pf: sum(pf.mean))
    weeks = get_config().supply.distributor_storage_weeks
    for pf in mine[:max(round(len(mine) * SLOW_SKU_SHARE), 1)]:
        key = (pf.sku_id, dist)
        stock[key] = max(stock[key], sum(pf.mean) / len(pf.mean) * 7 * weeks)


def run_policy(scenario_id: str, policy: Policy, opening_state: OpeningState, seed: int,
               ) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Daily loop over the test window. Returns (sim_log, sim_trips) with store.TABLES columns.
    Enforces credit cuts identically for every policy and asserts stock conservation every day."""
    raise NotImplementedError("M1: FR-09")


def run_experiment(experiment_id: str, req: ExperimentRequest,
                   progress: Callable[[float], None] | None = None) -> None:
    """Run all seeds x opening states x policies in parallel; write sim_log, sim_trips and kpi_results
    via dia_engine.store, then store.save_results(kpi.summarise(...))."""
    raise NotImplementedError("M1: FR-09")
