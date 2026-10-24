"""FR-09 Simulation harness, PRD 6.6.5 (owner: Member A)."""
from __future__ import annotations

from datetime import date
from typing import Callable

import pandas as pd

from engine.baseline_a import BaselineA
from engine.baseline_b import BaselineB
from engine.models import EngineSettings, ExperimentRequest, OpeningState, Snapshot
from engine.pipeline import EnginePolicy
from engine.policy import Policy

# Ablation and policy switches (FR-12). Contract: names match models.PolicyName.
POLICY_SETTINGS: dict[str, EngineSettings] = {
    "engine": EngineSettings(),
    "abl_no_expiry": EngineSettings(no_expiry_term=True),
    "abl_no_truck_steps": EngineSettings(no_truck_steps=True),
    "abl_naive_forecast": EngineSettings(forecast_model="seasonal_naive"),
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


def get_snapshot(scenario_id: str, as_of: date, opening_state: OpeningState = "imbalanced") -> Snapshot:
    """State on as_of. On the first test day this is the opening state; later days replay the engine policy."""
    raise NotImplementedError("Member A: FR-09")


def run_policy(scenario_id: str, policy: Policy, opening_state: OpeningState, seed: int,
               ) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Daily loop over the test window. Returns (sim_log, sim_trips) with store.TABLES columns.
    Enforces credit cuts identically for every policy and asserts stock conservation every day."""
    raise NotImplementedError("Member A: FR-09")


def run_experiment(experiment_id: str, req: ExperimentRequest,
                   progress: Callable[[float], None] | None = None) -> None:
    """Run all seeds x opening states x policies in parallel; write sim_log, sim_trips and kpi_results
    via engine.store, then store.save_results(kpi.summarise(...))."""
    raise NotImplementedError("Member A: FR-09")
