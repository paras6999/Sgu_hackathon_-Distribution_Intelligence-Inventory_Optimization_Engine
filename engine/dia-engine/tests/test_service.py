"""The internal engine service end to end through HTTP, with default request bodies as the backend sends them.
Regression guard: pydantic enum fields can arrive as plain strings, which broke `.value` calls on three routes."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from dia_engine.service.app import app


@pytest.fixture(autouse=True)
def _use_seed01(seed01, monkeypatch):
    monkeypatch.setenv("DIA_DATA_DIR", seed01)


@pytest.fixture(scope="module")
def client():
    return TestClient(app)


def test_health_and_scenarios(client):
    assert client.get("/health").json()["status"] == "ok"
    assert "seed01" in client.get("/scenarios").json()


def test_forecast_with_the_default_model(client):
    r = client.post("/forecast", json={"scenario_id": "seed01", "as_of": "2025-09-29"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pairs"] and body["weekly"] and body["horizon_days"] == 28


def test_backtest_metrics(client):
    m = client.get("/scenarios/seed01/backtest").json()
    assert 0 < m["wape"] < m["wape_seasonal_naive"]
    assert abs(m["bias"]) < 0.05 and 0.7 < m["coverage_p10_p90"] < 0.9


def test_snapshot_first_day_and_a_later_day(client):
    for day in ("2025-09-29", "2025-10-06"):
        r = client.get("/scenarios/seed01/snapshot", params={"as_of": day, "opening_state": "neutral"})
        assert r.status_code == 200 and r.json()["as_of"] == day
    assert client.get("/scenarios/seed01/snapshot", params={"as_of": "2026-06-01"}).status_code == 422


def test_plan_with_default_settings(client):
    r = client.post("/plan", json={"scenario_id": "seed01", "as_of": "2025-09-29", "temp_class": "chilled",
                                   "opening_state": "neutral", "plan_id": "PL-SVC", "version": 1})
    assert r.status_code == 200, r.text
    plan = r.json()
    assert plan["lines"] and all(l["reasons"] for l in plan["lines"])
