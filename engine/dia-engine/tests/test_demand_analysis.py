"""Demand analysis: two years of history, backtest against it, and what the forecaster learned."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from dia_engine.forecast.analysis import demand_history, learned_effects
from dia_engine.service.app import app


@pytest.fixture(autouse=True)
def _use_seed01(seed01, monkeypatch):
    monkeypatch.setenv("DIA_DATA_DIR", seed01)


def test_history_covers_two_years_and_the_test_window():
    h = demand_history("seed01")
    assert len(h.weekly) >= 100 and h.weekly[0].week_start.isoformat() == "2023-09-25"
    assert h.has_band is False and h.label == "All distributors · all SKUs"
    assert sum(p.actual for p in h.weekly) > 0 and {w.name for w in h.festivals} >= {"Diwali", "Holi"}


def test_single_pair_has_a_band_and_a_backtest_that_tracks_actuals():
    h = demand_history("seed01", "D05-Delhi", "SN-01")
    assert h.has_band and len(h.backtest) == 48
    assert all(b.p10 <= b.p50 <= b.p90 for b in h.backtest)
    by_week = {p.week_start: p.actual for p in h.weekly}
    assert all(abs(b.actual - by_week[b.week_start]) < 1e-6 for b in h.backtest)     # backtest actuals are the history
    err = sum(abs(b.actual - b.p50) for b in h.backtest) / sum(b.actual for b in h.backtest)
    assert err < 0.6


def test_aggregated_view_sums_pairs_and_drops_the_band():
    one = demand_history("seed01", "D05-Delhi", "SN-01")
    row = demand_history("seed01", "D05-Delhi")
    assert row.has_band is False and all(b.p10 == b.p90 == b.p50 for b in row.backtest)
    assert row.weekly[10].actual > one.weekly[10].actual
    assert {w.name for w in demand_history("seed01", "D05-Delhi", "SN-01").festivals} <= {w.name for w in demand_history("seed01").festivals}


def test_unknown_selection_is_a_client_error():
    with pytest.raises(ValueError):
        demand_history("seed01", "D99-Nowhere")
    assert TestClient(app).get("/scenarios/seed01/history", params={"dist_id": "D99-Nowhere"}).status_code == 422


def test_learned_festival_effects_are_close_to_the_configured_ones():
    e = learned_effects("seed01")
    names = {f.name: f for f in e.festivals}
    assert names["Diwali"].learned["snacks"] == pytest.approx(names["Diwali"].configured["snacks"], abs=0.3)
    cells = [abs(f.learned[c] - f.configured[c]) for f in e.festivals for c in f.learned if c in f.configured]
    assert len(cells) >= 20 and sum(cells) / len(cells) < 0.2          # about 0.12 on seed01
    assert all(v >= 1.0 for f in e.festivals for v in f.learned.values())


def test_seasonality_and_weather_are_reported_with_their_configured_values():
    e = learned_effects("seed01")
    assert set(e.seasonality) == set(e.seasonality_configured) and all(len(v) == 12 for v in e.seasonality.values())
    assert e.seasonality["beverages"][4] > e.seasonality["beverages"][11]            # direction recovered; size is not (level adapts instead)
    assert all(0 <= w.heat_pct_per_degc_learned <= 10 and 0 <= w.rain_cut_pct_learned <= 60 for w in e.weather)
    assert {w.category for w in e.weather} == set(e.seasonality)


def test_http_routes():
    c = TestClient(app)
    assert c.get("/scenarios/seed01/history", params={"dist_id": "D05-Delhi", "sku_id": "SN-01"}).json()["has_band"] is True
    assert c.get("/scenarios/seed01/effects").json()["festivals"]
