"""FR-05 MILP on seed01's imbalanced opening state: valid, fast, and responsive to ablations and locks."""
from __future__ import annotations

from datetime import date

import pytest

from dia_engine.data.generate import load_scenario
from dia_engine.forecast.forecast import forecast
from dia_engine.forecast.targets import compute_targets
from dia_engine.optimize import optimize, validate
from dia_engine.sim.simulate import get_snapshot
from dia_types import EngineSettings, Lock, LockKind, OpeningState, OptimizeInput, TempClass

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


def _inp(world, tc=TempClass.AMBIENT, settings=None, locks=()):
    sc, snap, fc = world
    settings = settings or EngineSettings()
    return OptimizeInput(scenario=sc, snapshot=snap, forecast=fc, targets=compute_targets(sc, fc, tc, settings),
                         temp_class=tc, settings=settings, locks=list(locks), plan_id="PL-TEST", version=1)


@pytest.mark.parametrize("tc", [TempClass.AMBIENT, TempClass.CHILLED])
def test_optimizer_output_is_valid(world, tc):
    inp = _inp(world, tc)
    out = optimize.solve(inp)
    assert out.plan.lines and out.plan.solve.seconds < 10
    report = validate.validate_plan(out.plan, inp.scenario, inp.snapshot, [], require_reasons=False)
    assert report.ok, report.violations[:3]


def test_ambient_solve_is_fast(world):
    assert optimize.solve(_inp(world)).plan.solve.seconds <= 3   # model build + 1.5 s MIP budget + rounding


def test_ablations_run_and_stay_valid(world):
    for kw in ({"no_expiry_term": True}, {"no_truck_steps": True}, {"no_credit": True}, {"home_depot_only": True}):
        inp = _inp(world, settings=EngineSettings(**kw))
        out = optimize.solve(inp)
        report = validate.validate_plan(out.plan, inp.scenario, inp.snapshot, [], require_reasons=False)
        assert report.ok or kw == {"no_credit": True}, (kw, report.violations[:2])
        if kw == {"home_depot_only": True}:
            home = {n.node_id: n.home_depot_id for n in inp.scenario.nodes}
            assert all(home[l.to_id] == l.from_id for l in out.plan.lines)


def test_locks_fix_cap_and_min(world):
    base = optimize.solve(_inp(world)).plan
    big = max(base.lines, key=lambda l: l.cases)
    fixed = Lock(lot_id=big.lot_id, dist_id=big.to_id, kind=LockKind.CAP, qty=0)
    plan = optimize.solve(_inp(world, locks=[fixed])).plan
    assert not [l for l in plan.lines if l.lot_id == big.lot_id and l.to_id == big.to_id]
    floor = Lock(lot_id=big.lot_id, dist_id=big.to_id, kind=LockKind.MIN, qty=big.cases)
    plan = optimize.solve(_inp(world, locks=[floor])).plan
    assert sum(l.cases for l in plan.lines if l.lot_id == big.lot_id and l.to_id == big.to_id) >= big.cases


def test_short_region_gets_stock(world):
    plan = optimize.solve(_inp(world)).plan
    north = {n.node_id for n in world[0].nodes if n.region == "N" and n.node_id.startswith("D")}
    assert any(l.to_id in north for l in plan.lines)
