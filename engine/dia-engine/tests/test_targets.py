"""FR-04 target checks: newsvendor ordering (chilled below ambient), pre-build, ablation (e), formula."""
from __future__ import annotations

import math
from datetime import date

from dia_engine.config import get_config
from dia_engine.forecast.targets import UNIFORM_CR, compute_targets, cover_days
from dia_types import EngineSettings, ForecastBundle, PairForecast, Scenario, TempClass, load_fixture


def _fixtures():
    return load_fixture("scenario", Scenario), load_fixture("forecast", ForecastBundle)


def test_targets_formula_and_scope():
    sc, fc = _fixtures()
    ambient = compute_targets(sc, fc, TempClass.AMBIENT)
    ambient_skus = {s.sku_id for s in sc.skus if s.temp_class == TempClass.AMBIENT}
    assert ambient and {t.sku_id for t in ambient} <= ambient_skus
    lo, hi = get_config().planning.critical_ratio_clip
    for t in ambient:
        assert lo <= t.critical_ratio <= hi
        assert math.isclose(t.S, t.mu + t.z * t.sigma, rel_tol=1e-9)


def test_chilled_service_level_below_ambient():
    sc, fc = _fixtures()
    chilled = compute_targets(sc, fc, TempClass.CHILLED)
    ambient = compute_targets(sc, fc, TempClass.AMBIENT)
    assert chilled and max(t.critical_ratio for t in chilled) < min(t.critical_ratio for t in ambient)


def test_uniform_service_level_ablation():
    sc, fc = _fixtures()
    out = compute_targets(sc, fc, TempClass.AMBIENT, EngineSettings(uniform_service_level=True))
    assert {round(t.critical_ratio, 6) for t in out} == {UNIFORM_CR}


def _pf(festival: list[float]) -> PairForecast:
    n = len(festival)
    return PairForecast(sku_id="SN-01", dist_id="D01-Pune", start=date(2025, 10, 6), mean=[5.0] * n, var=[8.0] * n,
                        festival=festival, weather=[1.0] * n, promo=[1.0] * n, model="AutoETS")


def test_festival_prebuild_extends_ambient_only():
    fest = [1.0] * 28
    for i in range(12, 15):            # festival on days 12-14 (Sat 18 - Mon 20 Oct)
        fest[i] = 1.4
    pf = _pf(fest)
    assert cover_days(pf, TempClass.AMBIENT, 1.0) == 21      # 6 Oct through Sunday 26 Oct (end of festival week)
    assert cover_days(pf, TempClass.CHILLED, 1.0) == 3       # R 2 + L 1, never pre-builds
    assert cover_days(_pf([1.0] * 28), TempClass.AMBIENT, 1.0) == 8


def test_targets_on_generated_scenario(seed01, monkeypatch):
    """Acceptance on real data: every chilled SKU has a lower CR than every ambient SKU of similar margin."""
    monkeypatch.setenv("DIA_DATA_DIR", seed01)
    from dia_engine.data.generate import load_scenario
    from dia_engine.forecast.forecast import forecast
    sc = load_scenario("seed01")
    fc = forecast("seed01", date(2025, 10, 13))
    margin = {s.sku_id: s.margin_inr / s.price_inr for s in sc.skus}
    chilled = compute_targets(sc, fc, TempClass.CHILLED)
    ambient = compute_targets(sc, fc, TempClass.AMBIENT)
    assert len(chilled) == 4 * 16 and len(ambient) == 20 * 16
    dairy_margin = max(margin[t.sku_id] for t in chilled)
    similar = [t for t in ambient if abs(margin[t.sku_id] - dairy_margin) <= 0.10]
    assert similar and max(t.critical_ratio for t in chilled) < min(t.critical_ratio for t in similar)
