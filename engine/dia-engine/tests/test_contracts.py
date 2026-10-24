"""Engine contract tests (run in CI on every PR). They keep the workstreams connected.

1. Shared fixtures (packages/dia-types/fixtures) load into the generated pydantic models.
2. The parquet store rejects wrong table columns.
3. Each engine module, once implemented, is called on fixture inputs and must return the contract type.
   Unimplemented modules are skipped, so this file stays green as work lands.
4. The internal service answers on generated data and maps unbuilt modules to 501.
"""
from __future__ import annotations

import importlib
from datetime import date

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from dia_engine import store
from dia_engine.config import load_config
from dia_types import (
    BacktestMetrics, EngineSettings, ExperimentResults, ForecastBundle, OptimizeInput, Plan, Scenario, Snapshot,
    SolveOutput, Target, TempClass, ValidationReport, load_fixture,
)


def _call_or_skip(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except NotImplementedError as e:
        pytest.skip(f"not implemented yet: {e}")


def _optimize_input() -> OptimizeInput:
    return OptimizeInput(scenario=load_fixture("scenario", Scenario), snapshot=load_fixture("snapshot", Snapshot),
                         forecast=load_fixture("forecast", ForecastBundle), targets=load_fixture("targets", list[Target]),
                         temp_class=TempClass.AMBIENT, settings=EngineSettings(), plan_id="PL-FAKE01", version=1)


# --------------------------------------------------------------------------- 1. fixtures and config

def test_config_loads():
    cfg = load_config()
    assert len(cfg.catalogue.depots) == 4 and len(cfg.catalogue.distributors) == 16 and len(cfg.catalogue.skus) == 24


@pytest.mark.parametrize("name,model", [
    ("scenario", Scenario), ("snapshot", Snapshot), ("forecast", ForecastBundle), ("backtest", BacktestMetrics),
    ("targets", list[Target]), ("plan", Plan), ("results", ExperimentResults),
])
def test_fixture_matches_python_models(name, model):
    assert load_fixture(name, model)


def test_fixture_plan_is_consistent():
    plan, snap = load_fixture("plan", Plan), load_fixture("snapshot", Snapshot)
    lots = {l.lot_id for l in snap.depot_lots}
    assert all(l.lot_id in lots and l.reasons and (l.truck_id or l.consignment_id) for l in plan.lines)
    assert {i for t in plan.trucks for i in t.line_ids} == {l.line_id for l in plan.lines}


# --------------------------------------------------------------------------- 2. store

def test_store_rejects_wrong_columns():
    with pytest.raises(ValueError):
        store.write_table("events", pd.DataFrame({"date": [], "oops": []}), "seed01")


def test_store_roundtrip():
    cols = store.TABLES["events"][1]
    store.write_table("events", pd.DataFrame([[date(2025, 10, 20), "W", "snacks", "festival", "Diwali", 1.5]],
                                             columns=cols), "seed01")
    assert store.read_table("events", "seed01").shape == (1, len(cols))


# --------------------------------------------------------------------------- 3. modules vs contracts

def test_window_helper():
    from dia_engine.forecast.dist import window
    pf = load_fixture("forecast", ForecastBundle).pairs[0]
    mean, var = window(pf, pf.start, 7)
    assert mean == pytest.approx(sum(pf.mean[:7])) and var == pytest.approx(sum(pf.var[:7]))


def test_dist_functions():
    from dia_engine.forecast import dist
    q = _call_or_skip(dist.quantile, 50.0, 80.0, 0.5)
    assert 40 <= q <= 60
    assert dist.expected_shortfall(50.0, 80.0, 0.0) == pytest.approx(50.0, rel=1e-3)
    assert dist.expected_leftover(50.0, 80.0, 0.0) == pytest.approx(0.0, abs=1e-6)


def test_targets_contract():
    from dia_engine.forecast.targets import compute_targets
    out = _call_or_skip(compute_targets, load_fixture("scenario", Scenario), load_fixture("forecast", ForecastBundle),
                        TempClass.AMBIENT)
    assert out and all(isinstance(t, Target) for t in out)


def test_validator_accepts_fixture_plan():
    from dia_engine.optimize.validate import validate_plan
    rep = _call_or_skip(validate_plan, load_fixture("plan", Plan), load_fixture("scenario", Scenario),
                        load_fixture("snapshot", Snapshot))
    assert isinstance(rep, ValidationReport) and rep.ok, rep.violations


def test_validator_catches_overshipment():
    from dia_engine.optimize.validate import validate_plan
    plan = load_fixture("plan", Plan)
    plan.lines[2].cases = 10_000
    rep = _call_or_skip(validate_plan, plan, load_fixture("scenario", Scenario), load_fixture("snapshot", Snapshot))
    assert not rep.ok


def test_optimizer_output_is_valid():
    from dia_engine.optimize import explain, optimize, validate
    inp = _optimize_input()
    out = _call_or_skip(optimize.solve, inp)
    assert isinstance(out, SolveOutput)
    plan = _call_or_skip(explain.add_reasons, out, inp)
    rep = _call_or_skip(validate.validate_plan, plan, inp.scenario, inp.snapshot)
    assert rep.ok, rep.violations
    assert all(l.reasons for l in plan.lines)


@pytest.mark.parametrize("module,cls", [("dia_engine.baselines.baseline_a", "BaselineA"),
                                        ("dia_engine.baselines.baseline_b", "BaselineB")])
def test_baselines_contract(module, cls):
    policy = getattr(importlib.import_module(module), cls)()
    plan = _call_or_skip(policy.plan, load_fixture("scenario", Scenario), load_fixture("snapshot", Snapshot),
                         load_fixture("forecast", ForecastBundle), TempClass.AMBIENT)
    assert isinstance(plan, Plan) and plan.policy.value == policy.name


def test_forecast_contract(seed01, monkeypatch):
    from dia_engine.forecast.forecast import backtest, forecast
    monkeypatch.setenv("DIA_DATA_DIR", seed01)
    fc = _call_or_skip(forecast, "seed01", date(2025, 9, 29))
    assert isinstance(fc, ForecastBundle) and fc.pairs
    assert isinstance(_call_or_skip(backtest, "seed01"), BacktestMetrics)


# --------------------------------------------------------------------------- 4. internal service

def test_service_on_generated_data(seed01, monkeypatch):
    monkeypatch.setenv("DIA_DATA_DIR", seed01)
    from dia_engine.service.app import app
    c = TestClient(app)
    assert c.get("/health").json()["status"] == "ok"
    assert c.get("/scenarios").json() == ["seed01"]
    sc = Scenario.model_validate(c.get("/scenarios/seed01").json())
    assert len(sc.nodes) == 20 and len(sc.lanes) == 64
    assert c.get("/scenarios/nope").status_code == 404
    rows = c.get("/assumptions").json()
    assert any(r["parameter"] == "costs.diesel_inr_per_l" and r["source"] for r in rows)


def test_service_maps_unbuilt_modules_to_501(seed01, monkeypatch):
    monkeypatch.setenv("DIA_DATA_DIR", seed01)
    from dia_engine.service.app import app
    r = TestClient(app).post("/plan", json={"scenario_id": "seed01", "as_of": "2025-09-29", "temp_class": "ambient",
                                            "plan_id": "PL-T1"})
    assert r.status_code in (200, 501), r.text
