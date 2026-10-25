"""FR-06 counterfactual check of the CHEAPEST_SOURCE and EXPIRY_PUSH reason codes.

Criterion, taken from what explain.py claims for each code. Each sampled line is removed by locking its arc
(lot_id -> to_id) to zero quantity (LockKind.CAP, qty=0) and the same OptimizeInput is re-solved:

* CHEAPEST_SOURCE says the line's source is the cheapest per-case option. Removing it must raise the plan's
  freight per case (expected_kpis.freight_inr / expected_kpis.cases). Agree when after > before.
* EXPIRY_PUSH says shipping this lot to this distributor avoids expected expiry. Removing it must raise the
  plan's expected expiry cost (expected_kpis.expiry_inr). Agree when after > before.

Sample: 10 lines of the ambient imbalanced seed01 plan (2025-09-29) whose primary (first) reason is one of
those two codes, drawn with random.Random(7). The test asserts agreement >= 0.9 and prints one row per line.
"""
from __future__ import annotations

import random
from datetime import date

import pytest

from dia_engine.data.generate import load_scenario
from dia_engine.forecast.forecast import forecast
from dia_engine.forecast.targets import compute_targets
from dia_engine.optimize import explain, optimize
from dia_engine.sim.simulate import get_snapshot
from dia_types import Lock, LockKind, OpeningState, OptimizeInput, ReasonCode as R, TempClass

T0 = date(2025, 9, 29)
SAMPLE = 10
MIN_AGREEMENT = 0.9
TEST_MIP_BUDGET_S = 8.0
CODES = (R.CHEAPEST_SOURCE, R.EXPIRY_PUSH)


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


@pytest.fixture(scope="module")
def ambient(world):
    sc, snap, fc = world
    inp = OptimizeInput(scenario=sc, snapshot=snap, forecast=fc, targets=compute_targets(sc, fc, TempClass.AMBIENT),
                        temp_class=TempClass.AMBIENT, plan_id="PL-CF", version=1)
    return inp, explain.add_reasons(optimize.solve(inp), inp)


@pytest.mark.xfail(strict=True, reason=(
    "Open finding: agreement is 6/10 with the 1.5 s budget (two runs: 6/10 and 9/10 on identical code) and 6/10 "
    "with an 8 s budget. The criterion (freight per case) is not confirmed as the meaning of the CHEAPEST_SOURCE claim. "
    "Expected failure until a human decides the criterion; see docs/Ground-truth.md."))
def test_removing_a_reason_line_moves_the_kpi_it_claims(world, monkeypatch):
    # The production MIP budget (1.5 s) stops HiGHS before it proves its gap, so identical code gave 6/10 and then
    # 9/10 agreement in two runs. The base plan and every re-solve use the same larger budget, so the comparison is
    # between like with like and the check measures the model, not the clock.
    monkeypatch.setattr(optimize, "MIP_BUDGET_S", TEST_MIP_BUDGET_S)
    sc, snap, fc = world
    inp = OptimizeInput(scenario=sc, snapshot=snap, forecast=fc, targets=compute_targets(sc, fc, TempClass.AMBIENT),
                        temp_class=TempClass.AMBIENT, plan_id="PL-CF", version=1)
    plan = explain.add_reasons(optimize.solve(inp), inp)
    candidates = [l for l in plan.lines if l.reasons and l.reasons[0].code in CODES]
    picks = random.Random(7).sample(candidates, SAMPLE)
    base = plan.expected_kpis

    rows = []
    for line in picks:
        code = line.reasons[0].code
        lock = Lock(lot_id=line.lot_id, dist_id=line.to_id, kind=LockKind.CAP, qty=0)
        cf = optimize.solve(inp.model_copy(update={"locks": [*inp.locks, lock]})).plan.expected_kpis
        if code is R.CHEAPEST_SOURCE:
            before, after = base.freight_inr / base.cases, cf.freight_inr / cf.cases
        else:
            before, after = base.expiry_inr, cf.expiry_inr
        rows.append((line.line_id, code.value, before, after, after > before))

    agree = sum(r[4] for r in rows) / len(rows)
    print(f"\n{'line_id':<26}{'code':<18}{'before':>14}{'after':>14}  agree")
    for line_id, code, before, after, ok in rows:
        print(f"{line_id:<26}{code:<18}{before:>14.4f}{after:>14.4f}  {ok}")
    print(f"agreement {agree:.2f} ({sum(r[4] for r in rows)}/{len(rows)})")
    assert agree >= MIN_AGREEMENT
