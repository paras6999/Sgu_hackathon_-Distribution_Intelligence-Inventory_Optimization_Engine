"""Contract tests: run on every PR (CI). They keep the four workstreams connected.

1. Fakes are valid contracts and the config loads.
2. The storage layer round-trips every app-state object and rejects wrong table columns.
3. Each real module, once implemented, is called on fake inputs and must return the contract type.
   Unimplemented modules are skipped, so this file goes green -> stays green as work lands.
4. The full API journey (plan -> publish -> inbox -> trim -> 409 -> dispatch -> experiment) runs
   on the fake backend.
"""
from __future__ import annotations

import importlib
from datetime import date

import pandas as pd
import pytest

from engine import fakes, store
from engine.config import load_config
from engine.models import (
    BacktestMetrics, ExperimentStatus, ForecastBundle, Plan, PlanEvent, Proposal, ProposalStatus, Scenario,
    SolveOutput, Target, TempClass, ValidationReport,
)


@pytest.fixture(autouse=True)
def tmp_data(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "DATA_DIR", tmp_path)
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "vitaran.db")
    yield tmp_path


def _call_or_skip(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except NotImplementedError as e:
        pytest.skip(f"not implemented yet: {e}")


# --------------------------------------------------------------------------- 1. fakes and config

def test_config_loads():
    cfg = load_config()
    assert cfg.network.depots and cfg.costs.ftl["AMB32"].kg == 7000


def test_fakes_are_valid_and_consistent():
    sc, snap, fc, plan = fakes.fake_scenario(), fakes.fake_snapshot(), fakes.fake_forecast(), fakes.fake_plan()
    node_ids = {n.node_id for n in sc.nodes}
    sku_ids = {s.sku_id for s in sc.skus}
    assert {l.depot_id for l in snap.depot_lots} <= node_ids
    assert {(p.sku_id in sku_ids, p.dist_id in node_ids) for p in fc.pairs} == {(True, True)}
    lots = {l.lot_id: l for l in snap.depot_lots}
    for line in plan.lines:
        assert line.lot_id in lots and line.reasons and (line.truck_id or line.consignment_id)
    assert {i for t in plan.trucks for i in t.line_ids} == {l.line_id for l in plan.lines}


def test_plan_json_roundtrip():
    plan = fakes.fake_plan()
    assert Plan.model_validate_json(plan.model_dump_json()) == plan


# --------------------------------------------------------------------------- 2. storage

def test_store_rejects_wrong_columns():
    with pytest.raises(ValueError):
        store.write_table("events", pd.DataFrame({"date": [], "oops": []}), "seed01")


def test_store_table_roundtrip():
    cols = store.TABLES["events"][1]
    df = pd.DataFrame([[date(2025, 10, 20), "W", "snacks", "festival", "Diwali", 1.4]], columns=cols)
    store.write_table("events", df, "seed01")
    assert store.read_table("events", "seed01").shape == (1, len(cols))


def test_store_app_state():
    plan = fakes.fake_plan("PL-T1", 1)
    store.save_plan(plan)
    store.save_plan(fakes.fake_plan("PL-T1", 2))
    assert store.load_plan("PL-T1").version == 2 and store.load_plan("PL-T1", 1) == plan
    store.upsert_proposal(Proposal(plan_id="PL-T1", dist_id="D01-Pune", proposal_version=1,
                                   status=ProposalStatus.PROPOSED))
    assert store.get_proposals("PL-T1")[0].dist_id == "D01-Pune"
    store.log_event(PlanEvent(plan_id="PL-T1", plan_version=2, dist_id=None, actor="planner", action="publish",
                              ts=plan.created_at))
    assert store.list_events("PL-T1")[0].action == "publish"
    exp_id, cached = store.create_experiment("abc")
    assert not cached and store.create_experiment("abc") == (exp_id, True)
    store.update_experiment(exp_id, ExperimentStatus.DONE, 100)
    assert store.get_experiment(exp_id).status is ExperimentStatus.DONE


# --------------------------------------------------------------------------- 3. real modules vs contracts

def test_window_helper():
    from engine.dist import window
    pf = fakes.fake_forecast().pairs[0]
    mean, var = window(pf, pf.start, 7)
    assert mean == pytest.approx(sum(pf.mean[:7])) and var == pytest.approx(sum(pf.var[:7]))


def test_dist_functions():
    from engine import dist
    q = _call_or_skip(dist.quantile, 50.0, 80.0, 0.5)
    assert 40 <= q <= 60
    assert dist.expected_shortfall(50.0, 80.0, 0.0) == pytest.approx(50.0, rel=1e-3)
    assert dist.expected_leftover(50.0, 80.0, 0.0) == pytest.approx(0.0, abs=1e-6)


def test_targets_contract():
    from engine.targets import compute_targets
    out = _call_or_skip(compute_targets, fakes.fake_scenario(), fakes.fake_forecast(), TempClass.AMBIENT)
    assert out and all(isinstance(t, Target) for t in out)


def test_validator_accepts_fake_plan():
    from engine.validate import validate_plan
    rep = _call_or_skip(validate_plan, fakes.fake_plan(), fakes.fake_scenario(), fakes.fake_snapshot())
    assert isinstance(rep, ValidationReport) and rep.ok, rep.violations


def test_validator_catches_overshipment():
    from engine.validate import validate_plan
    plan = fakes.fake_plan()
    plan.lines[2].cases = 10_000
    rep = _call_or_skip(validate_plan, plan, fakes.fake_scenario(), fakes.fake_snapshot())
    assert not rep.ok


def test_optimizer_output_is_valid():
    from engine import explain, optimize, validate
    inp = fakes.fake_optimize_input()
    out = _call_or_skip(optimize.solve, inp)
    assert isinstance(out, SolveOutput)
    plan = _call_or_skip(explain.add_reasons, out, inp)
    rep = _call_or_skip(validate.validate_plan, plan, inp.scenario, inp.snapshot)
    assert rep.ok, rep.violations
    assert all(l.reasons for l in plan.lines)


@pytest.mark.parametrize("module,cls", [("engine.baseline_a", "BaselineA"), ("engine.baseline_b", "BaselineB")])
def test_baselines_contract(module, cls):
    policy = getattr(importlib.import_module(module), cls)()
    plan = _call_or_skip(policy.plan, fakes.fake_scenario(), fakes.fake_snapshot(), fakes.fake_forecast(),
                         TempClass.AMBIENT)
    assert isinstance(plan, Plan) and plan.policy == policy.name


def test_generator_and_loader_contract():
    from engine.config import get_config
    from engine.generate import generate, load_scenario
    sid = _call_or_skip(generate, get_config(), 1)
    for name, (scope, _) in store.TABLES.items():
        if scope == "scenario" and name in {"nodes", "skus", "lanes", "lots", "plant_receipts", "demand_daily", "events"}:
            assert store.table_exists(name, sid), name
    assert isinstance(load_scenario(sid), Scenario)


def test_forecast_contract():
    from engine.forecast import backtest, forecast
    if not store.table_exists("demand_daily", "seed01"):
        pytest.skip("needs generated scenario seed01 (Member A)")
    fc = _call_or_skip(forecast, "seed01", date(2025, 9, 29))
    assert isinstance(fc, ForecastBundle) and fc.pairs
    assert isinstance(_call_or_skip(backtest, "seed01"), BacktestMetrics)


# --------------------------------------------------------------------------- 4. API journey on fakes

@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("VITARAN_FAKE", "1")
    from fastapi.testclient import TestClient
    from api.main import app
    return TestClient(app)


def test_api_journey(client):
    assert client.get("/v1/health").json()["fake_backend"] is True
    assert client.get("/v1/scenarios/seed01/snapshot", params={"as_of": "2025-10-13"}).status_code == 200
    assert client.post("/v1/forecasts", json={"scenario_id": "seed01", "as_of": "2025-10-13"}).status_code == 200

    r = client.post("/v1/plans", json={"scenario_id": "seed01", "as_of": "2025-10-13", "temp_class": "ambient"})
    assert r.status_code == 200, r.text
    plan = Plan.model_validate(r.json())

    pub = client.post(f"/v1/plans/{plan.plan_id}/publish", json={"version": 1}).json()
    assert {m["dist_id"] for m in pub["messages"]} == {l.to_id for l in plan.lines}

    msg = client.get(f"/v1/plans/{plan.plan_id}/inbox/D01-Pune").json()
    line_id = msg["line_ids"][0]
    body = {"dist_id": "D01-Pune", "proposal_version": 1,
            "actions": [{"line_id": line_id, "action": "trim", "qty": 60}]}
    res = client.post(f"/v1/plans/{plan.plan_id}/responses", json=body)
    assert res.status_code == 200, res.text
    assert res.json()["plan_version"] == 2

    stale = dict(body, proposal_version=0)
    assert client.post(f"/v1/plans/{plan.plan_id}/responses", json=stale).status_code == 409

    events = client.get(f"/v1/plans/{plan.plan_id}/events").json()
    assert [e["action"] for e in events] == ["publish", "trim"]

    d = client.get(f"/v1/plans/{plan.plan_id}/dispatch", params={"depot": "W1-Bhiwandi"}).json()
    assert d["trucks"] and all(t["truck"]["from_id"] == "W1-Bhiwandi" for t in d["trucks"])
    csv = client.get(f"/v1/plans/{plan.plan_id}/dispatch.csv")
    assert csv.content.startswith("﻿".encode("utf-8"))

    ex = client.post("/v1/experiments", json={})
    assert ex.status_code == 202
    exp_id = ex.json()["experiment_id"]
    assert client.get(f"/v1/experiments/{exp_id}").json()["status"] == "done"
    assert client.get(f"/v1/experiments/{exp_id}/results").json()["kpis"]

    rows = client.get("/v1/assumptions").json()
    assert any(r["parameter"] == "costs.diesel_inr_per_l" and r["source"] for r in rows)


def test_api_returns_501_for_unbuilt_engine(monkeypatch):
    monkeypatch.delenv("VITARAN_FAKE", raising=False)
    from fastapi.testclient import TestClient
    from api.main import app
    r = TestClient(app).get("/v1/scenarios")
    assert r.status_code in (200, 501)
