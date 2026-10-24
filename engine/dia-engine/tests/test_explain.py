"""FR-06 reason codes: one test per code, on seed01 or a deliberately stressed variant of it."""
from __future__ import annotations

from datetime import date, timedelta

import pytest

from dia_engine.data.generate import load_scenario
from dia_engine.forecast.forecast import forecast
from dia_engine.forecast.targets import compute_targets
from dia_engine.optimize import explain, optimize, validate
from dia_engine.sim.simulate import get_snapshot
from dia_types import OpeningState, OptimizeInput, ReasonCode as R, TempClass

T0 = date(2025, 9, 29)


@pytest.fixture(autouse=True)
def _use_seed01(seed01, monkeypatch):
    monkeypatch.setenv("DIA_DATA_DIR", seed01)


@pytest.fixture(scope="module")
def world(seed01):
    mp = pytest.MonkeyPatch()
    mp.setenv("DIA_DATA_DIR", seed01)
    try:
        yield load_scenario("seed01"), get_snapshot("seed01", T0, OpeningState.IMBALANCED), forecast("seed01", T0)
    finally:
        mp.undo()


def _plan(world, tc=TempClass.AMBIENT, snap=None, fc=None):
    sc, s0, f0 = world
    snap, fc = snap or s0, fc or f0
    inp = OptimizeInput(scenario=sc, snapshot=snap, forecast=fc, targets=compute_targets(sc, fc, tc), temp_class=tc,
                        plan_id="PL-X", version=1)
    return explain.add_reasons(optimize.solve(inp), inp), inp


def _codes(plan) -> set[R]:
    return {r.code for l in plan.lines for r in l.reasons} | {r.code for s in plan.shortfalls for r in s.reasons}


@pytest.fixture(scope="module")
def ambient(world):
    return _plan(world)


@pytest.fixture(scope="module")
def chilled(world):
    return _plan(world, TempClass.CHILLED)


def test_every_line_has_one_or_two_ordered_reasons_and_validates(ambient, chilled):
    for plan, inp in (ambient, chilled):
        assert plan.lines and all(1 <= len(l.reasons) <= 2 for l in plan.lines)
        assert all(l.reasons[0].impact_inr >= l.reasons[-1].impact_inr for l in plan.lines)
        assert validate.validate_plan(plan, inp.scenario, inp.snapshot, []).ok


def test_cheapest_source(chilled):
    assert R.CHEAPEST_SOURCE in _codes(chilled[0])


def test_expiry_push(chilled):
    assert R.EXPIRY_PUSH in _codes(chilled[0])


def test_cliff_rescue(ambient):
    assert R.CLIFF_RESCUE in _codes(ambient[0])


def test_ftl_topup(chilled):
    assert R.FTL_TOPUP in _codes(chilled[0])


def test_festival_uplift(ambient):
    codes = {r.code: r for l in ambient[0].lines for r in l.reasons}
    assert "Diwali" in codes[R.FESTIVAL_UPLIFT].detail or "×" in codes[R.FESTIVAL_UPLIFT].detail


def test_credit_limited(ambient):
    assert R.CREDIT_LIMITED in _codes(ambient[0])


def test_weather_shift(world):
    sc, snap, fc = world
    hot = fc.model_copy(update={"pairs": [p.model_copy(update={"weather": [1.2] * len(p.weather)}) for p in fc.pairs]})
    assert R.WEATHER_SHIFT in _codes(_plan(world, fc=hot)[0])


def test_stock_limited(world):
    sc, snap, fc = world
    thin = snap.model_copy(update={"depot_lots": [l.model_copy(update={"qty_cases": max(l.qty_cases * 0.05, 1)})
                                                  for l in snap.depot_lots]})
    plan, _ = _plan(world, snap=thin)
    assert R.STOCK_LIMITED in {r.code for s in plan.shortfalls for r in s.reasons}


def test_storage_limited(world):
    sc, snap, fc = world
    full = snap.model_copy(update={"storage_free_m3": {k: 0.5 for k in snap.storage_free_m3}})
    plan, _ = _plan(world, snap=full)
    assert R.STORAGE_LIMITED in _codes(plan)


def test_mrsl_blocked(world):
    sc, snap, fc = world
    depot = "N1-Gurugram"
    plan, _ = _plan(world, snap=snap.model_copy(update={"depot_lots": [
        l.model_copy(update={"expiry_date": T0 + timedelta(days=int(0.3 * 180))}) if l.depot_id == depot else l
        for l in snap.depot_lots]}))
    assert R.MRSL_BLOCKED in _codes(plan)


def test_fair_share_floor_not_emitted_when_alpha_zero(ambient, chilled):
    assert R.FAIR_SHARE_FLOOR not in _codes(ambient[0]) | _codes(chilled[0])
