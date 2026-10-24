"""FR-09 Simulation harness, PRD 6.6.5 (owner: M1)."""
from __future__ import annotations

from datetime import date
from typing import Callable

import pandas as pd

from dia_engine.baselines.baseline_a import BaselineA
from dia_engine.baselines.baseline_b import BaselineB
from dia_types import EngineSettings, ExperimentRequest, ForecastMode, OpeningState, Snapshot
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


def get_snapshot(scenario_id: str, as_of: date, opening_state: OpeningState = OpeningState.IMBALANCED) -> Snapshot:
    """State on as_of. On the first test day this is the opening state; later days replay the engine policy."""
    raise NotImplementedError("M1: FR-09")


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
