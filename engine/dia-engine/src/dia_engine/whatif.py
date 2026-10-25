"""FR-19 what-if scenarios (owner: M1). Applied to a plan's inputs before the solve.

Pure functions: inputs are never mutated. A WhatIf with every field at its default returns the inputs unchanged.

* demand_shock_pct and shock_region: forecast mean x (1 + p/100) and variance x (1 + p/100)^2 for every
  distributor in the region (every region when shock_region is None).
* depot_outage_id: the depot's lots are removed from the snapshot. Depot stock is the only depot-held field.
* diesel_pct: lane FTL trip costs, PTL rate and PTL minimum charge rise by fuel_share x diesel_pct / 100.
  The non-fuel part of each freight cost does not move.
"""
from __future__ import annotations

from dia_engine.config import get_config
from dia_types import ForecastBundle, Scenario, Snapshot, WhatIf


def apply_what_if(scenario: Scenario, snapshot: Snapshot, forecast: ForecastBundle, what_if: WhatIf | None,
                  ) -> tuple[Scenario, Snapshot, ForecastBundle]:
    if what_if is None:
        return scenario, snapshot, forecast
    if what_if.diesel_pct:
        scenario = _diesel(scenario, what_if.diesel_pct)
    if what_if.depot_outage_id:
        snapshot = _outage(snapshot, what_if.depot_outage_id)
    if what_if.demand_shock_pct:
        forecast = _demand_shock(scenario, forecast, what_if.demand_shock_pct, what_if.shock_region)
    return scenario, snapshot, forecast


def _diesel(scenario: Scenario, diesel_pct: float) -> Scenario:
    factor = 1 + get_config().costs.ptl.fuel_share * diesel_pct / 100
    lanes = [lane.model_copy(update={
        "ftl_cost_inr": {k: v * factor for k, v in lane.ftl_cost_inr.items()},
        "ptl_rate_inr_per_kg": lane.ptl_rate_inr_per_kg * factor,
        "ptl_min_charge_inr": lane.ptl_min_charge_inr * factor,
    }) for lane in scenario.lanes]
    return scenario.model_copy(update={"lanes": lanes})


def _outage(snapshot: Snapshot, depot_id: str) -> Snapshot:
    lots = [lot for lot in snapshot.depot_lots if lot.depot_id != depot_id]
    return snapshot.model_copy(update={"depot_lots": lots})


def _demand_shock(scenario: Scenario, forecast: ForecastBundle, pct: float, region: str | None) -> ForecastBundle:
    region_of = {node.node_id: node.region for node in scenario.nodes}
    if region is not None and region not in set(region_of.values()):
        raise ValueError(f"shock_region {region!r} is not a region of scenario {scenario.scenario_id}")
    mult = 1 + pct / 100
    pairs = []
    for pf in forecast.pairs:
        if region is None or region_of.get(pf.dist_id) == region:
            pf = pf.model_copy(update={"mean": [m * mult for m in pf.mean], "var": [v * mult * mult for v in pf.var]})
        pairs.append(pf)
    return forecast.model_copy(update={"pairs": pairs})
