"""FR-03 forecast checks: PRD 8.3 accuracy targets, contract shape, no look-ahead, speed."""
from __future__ import annotations

import shutil
import time
from datetime import date
from pathlib import Path

import pytest

from dia_engine import store
from dia_engine.forecast import forecast as fc_mod
from dia_engine.forecast.forecast import backtest, forecast

AS_OF = date(2025, 10, 13)


def _clear_caches():
    for fn in (fc_mod._load, fc_mod._factors, fc_mod._levels, fc_mod._band_quantiles):
        fn.cache_clear()


@pytest.fixture()
def seed_dir(seed01, monkeypatch) -> str:
    monkeypatch.setenv("DIA_DATA_DIR", seed01)
    return seed01


def test_backtest_meets_prd_targets(seed_dir):
    m = backtest("seed01")
    assert m.wape <= 0.35
    assert m.wape <= 0.90 * m.wape_seasonal_naive
    assert abs(m.bias) <= 0.05
    assert 0.75 <= m.coverage_p10_p90 <= 0.85
    assert m.wape_festival_weeks <= 0.45


def test_forecast_shape_and_factors(seed_dir):
    fc = forecast("seed01", AS_OF, 28)
    assert len(fc.pairs) == 384 and len(fc.weekly) == 384 * 4
    for p in fc.pairs:
        assert len(p.mean) == len(p.var) == len(p.festival) == 28
        assert min(p.mean) >= 0 and min(p.var) > 0
    diwali = [w for w in fc.weekly if w.sku_id == "SN-01" and w.week_start == AS_OF]
    assert all("Diwali" in w.factors and w.factors["Diwali"] > 1.15 for w in diwali)
    for w in fc.weekly:
        assert w.p10 <= w.p50 <= w.p90


def test_seasonal_naive_mode(seed_dir):
    naive = forecast("seed01", AS_OF, 14, model="seasonal_naive")
    assert {p.model.value for p in naive.pairs} == {"SeasonalNaive"}


def test_no_look_ahead(seed_dir, tmp_path, monkeypatch):
    """Changing demand on/after as_of must not change the forecast."""
    before = forecast("seed01", AS_OF, 14)
    copy = tmp_path / "engine"
    shutil.copytree(seed_dir, copy)
    monkeypatch.setenv("DIA_DATA_DIR", str(copy))
    dd = store.read_table("demand_daily", "seed01")
    future = dd["date"] >= AS_OF
    dd.loc[future, "true_demand"] *= 10
    store.write_table("demand_daily", dd, "seed01")
    _clear_caches()
    after = forecast("seed01", AS_OF, 14)
    assert [p.mean for p in before.pairs] == [p.mean for p in after.pairs]


def test_weekly_update_is_fast(seed_dir):
    forecast("seed01", AS_OF, 28)                     # warm caches (factor fit)
    t = time.perf_counter()
    forecast("seed01", date(2025, 10, 20), 28)        # next week: level refit only
    assert time.perf_counter() - t <= 3.0
