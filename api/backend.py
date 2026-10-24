"""Backend switch for the API (owner: Member D).

VITARAN_FAKE=1 -> FakeBackend: every endpoint works on engine.fakes, so the UI and API can be
built and demoed before any engine code exists. Otherwise RealBackend calls the real modules;
an unfinished module raises NotImplementedError, which the API returns as HTTP 501.
Both backends have the same methods, so switching needs no API or UI change.
"""
from __future__ import annotations

import os
import re
from datetime import date

from engine import fakes, store
from engine.models import (
    BacktestMetrics, EngineSettings, ExperimentRequest, ExperimentStatus, ForecastBundle, LineStatus, Lock, Plan,
    Proposal, ResponseAction, ResponseRequest, Scenario, Snapshot, TempClass,
)


class RealBackend:
    fake = False

    def list_scenarios(self) -> list[str]:
        from engine.generate import list_scenarios
        return list_scenarios()

    def load_scenario(self, scenario_id: str) -> Scenario:
        from engine.generate import load_scenario
        return load_scenario(scenario_id)

    def snapshot(self, scenario_id: str, as_of: date, opening_state: str = "imbalanced") -> Snapshot:
        from engine.simulate import get_snapshot
        return get_snapshot(scenario_id, as_of, opening_state)

    def forecast(self, scenario_id: str, as_of: date, horizon_days: int = 28) -> ForecastBundle:
        from engine.forecast import forecast
        return forecast(scenario_id, as_of, horizon_days)

    def backtest(self, scenario_id: str) -> BacktestMetrics:
        from engine.forecast import backtest
        return backtest(scenario_id)

    def make_plan(self, scenario: Scenario, snapshot: Snapshot, forecast: ForecastBundle, temp_class: TempClass,
                  settings: EngineSettings, locks: list[Lock], plan_id: str, version: int) -> Plan:
        from engine.pipeline import make_plan
        return make_plan(scenario, snapshot, forecast, temp_class, settings, locks, plan_id, version)

    def apply_response(self, plan: Plan, proposals: list[Proposal], req: ResponseRequest, scenario: Scenario,
                       snapshot: Snapshot, forecast: ForecastBundle) -> Plan:
        from engine.pipeline import apply_response
        return apply_response(plan, proposals, req, scenario, snapshot, forecast)

    def run_experiment(self, experiment_id: str, req: ExperimentRequest) -> None:
        from engine.simulate import run_experiment
        try:
            store.update_experiment(experiment_id, ExperimentStatus.RUNNING, 0)
            run_experiment(experiment_id, req,
                           progress=lambda p: store.update_experiment(experiment_id, ExperimentStatus.RUNNING, p))
            store.update_experiment(experiment_id, ExperimentStatus.DONE, 100)
        except Exception as e:  # recorded on the job; GET /v1/experiments/{id} shows it
            store.update_experiment(experiment_id, ExperimentStatus.FAILED, 0, error=repr(e))


class FakeBackend:
    fake = True

    def list_scenarios(self) -> list[str]:
        return [fakes.SCENARIO_ID]

    def load_scenario(self, scenario_id: str) -> Scenario:
        return fakes.fake_scenario()

    def snapshot(self, scenario_id: str, as_of: date, opening_state: str = "imbalanced") -> Snapshot:
        return fakes.fake_snapshot()

    def forecast(self, scenario_id: str, as_of: date, horizon_days: int = 28) -> ForecastBundle:
        return fakes.fake_forecast()

    def backtest(self, scenario_id: str) -> BacktestMetrics:
        return fakes.fake_backtest()

    def make_plan(self, scenario: Scenario, snapshot: Snapshot, forecast: ForecastBundle, temp_class: TempClass,
                  settings: EngineSettings, locks: list[Lock], plan_id: str, version: int) -> Plan:
        return fakes.fake_plan(plan_id, version).model_copy(update={"settings": settings})

    def apply_response(self, plan: Plan, proposals: list[Proposal], req: ResponseRequest, scenario: Scenario,
                       snapshot: Snapshot, forecast: ForecastBundle) -> Plan:
        """Applies the actions directly (no re-solve, nothing grows). Line ids move to the new version."""
        new = plan.model_copy(deep=True)
        new.version = plan.version + 1
        acts = {a.line_id: a for a in req.actions}
        for line in new.lines:
            act = acts.get(line.line_id)
            if act is None:
                continue
            if act.action is ResponseAction.ACCEPT:
                line.status = LineStatus.ACCEPTED
            elif act.action is ResponseAction.TRIM:
                line.cases, line.status = int(act.qty), LineStatus.TRIMMED
            else:
                line.cases, line.status = 0, LineStatus.REJECTED
        ren = {l.line_id: re.sub(r"-v\d+-", f"-v{new.version}-", l.line_id) for l in new.lines}
        for line in new.lines:
            line.line_id = ren[line.line_id]
        for truck in new.trucks:
            truck.line_ids = [ren[i] for i in truck.line_ids]
        return new

    def run_experiment(self, experiment_id: str, req: ExperimentRequest) -> None:
        store.save_results(fakes.fake_results(experiment_id))
        store.update_experiment(experiment_id, ExperimentStatus.DONE, 100)


def get_backend() -> RealBackend | FakeBackend:
    return FakeBackend() if os.environ.get("VITARAN_FAKE") == "1" else RealBackend()
