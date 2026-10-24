"""FR-08 / C10: a distributor's response becomes locks and a real re-solve that disturbs nobody else."""
from __future__ import annotations

import time
from collections import defaultdict
from datetime import date, datetime, timezone

import pytest

from dia_engine.data.generate import load_scenario
from dia_engine.forecast.forecast import forecast
from dia_engine.optimize import validate
from dia_engine.optimize.pipeline import apply_response, locks_for_response, make_plan
from dia_engine.sim.simulate import get_snapshot
from dia_types import (
    LineAction, LineStatus, LockKind, OpeningState, Proposal, ProposalStatus, ResponseAction, ResponseRequest,
    TempClass,
)

T0 = date(2025, 9, 29)


@pytest.fixture(autouse=True)
def _use_seed01(seed01, monkeypatch):
    monkeypatch.setenv("DIA_DATA_DIR", seed01)


@pytest.fixture(scope="module")
def world(seed01):
    mp = pytest.MonkeyPatch()
    mp.setenv("DIA_DATA_DIR", seed01)
    try:
        sc, snap, fc = load_scenario("seed01"), get_snapshot("seed01", T0, OpeningState.IMBALANCED), forecast("seed01", T0)
        plan = make_plan(sc, snap, fc, TempClass.AMBIENT, plan_id="PL-R")
        yield sc, snap, fc, plan
    finally:
        mp.undo()


def _props(plan, **status):
    return [Proposal(plan_id=plan.plan_id, dist_id=d, proposal_version=1,
                     status=status.get(d.split("-")[0], ProposalStatus.PROPOSED), sent_at=datetime.now(timezone.utc))
            for d in sorted({l.to_id for l in plan.lines})]


def _qty(plan):
    out = defaultdict(int)
    for l in plan.lines:
        out[(l.lot_id, l.to_id)] += l.cases
    return out


def _pick(plan):
    """A distributor with at least two lines, and a second distributor to play 'already responded'."""
    by = defaultdict(list)
    for l in plan.lines:
        by[l.to_id].append(l)
    dists = sorted(by, key=lambda d: -len(by[d]))
    return dists[0], by[dists[0]], dists[1]


def test_locks_follow_the_c10_rules(world):
    _, _, _, plan = world
    me, mine, other = _pick(plan)
    third = next(d for d in _props(plan) if d.dist_id not in (me, other)).dist_id
    props = _props(plan, **{other.split("-")[0]: ProposalStatus.ACCEPTED})
    req = ResponseRequest(dist_id=me, proposal_version=1, actions=[
        LineAction(line_id=mine[0].line_id, action=ResponseAction.TRIM, qty=mine[0].cases // 2),
        LineAction(line_id=mine[1].line_id, action=ResponseAction.REJECT)])
    locks = locks_for_response(plan, props, req)
    kind = {(k.lot_id, k.dist_id): k for k in locks}
    assert kind[(mine[0].lot_id, me)].kind == LockKind.CAP
    assert kind[(mine[0].lot_id, me)].qty == mine[0].cases // 2 + sum(
        l.cases for l in mine if l.lot_id == mine[0].lot_id and l is not mine[0])
    assert kind[(mine[1].lot_id, me)].kind in (LockKind.FIX, LockKind.CAP) and kind[(mine[1].lot_id, me)].qty >= 0
    assert all(k.kind == LockKind.FIX for k in locks if k.dist_id == other)
    assert all(k.kind == LockKind.MIN for k in locks if k.dist_id == third)


def test_apply_response_resolves_without_disturbing_others(world):
    sc, snap, fc, plan = world
    me, mine, other = _pick(plan)
    props = _props(plan, **{other.split("-")[0]: ProposalStatus.ACCEPTED})
    line = max(mine, key=lambda l: l.cases)
    req = ResponseRequest(dist_id=me, proposal_version=1, actions=[
        LineAction(line_id=line.line_id, action=ResponseAction.TRIM, qty=line.cases // 2)])
    t = time.perf_counter()
    new = apply_response(plan, props, req, sc, snap, fc)
    elapsed = time.perf_counter() - t
    assert new.version == plan.version + 1 and new.plan_id == plan.plan_id
    assert validate.validate_plan(new, sc, snap, locks_for_response(plan, props, req)).ok
    old_q, new_q = _qty(plan), _qty(new)
    # responder: trimmed pair capped, the rest unchanged
    cap = line.cases // 2 + sum(l.cases for l in mine if l.lot_id == line.lot_id and l is not line)
    assert new_q[(line.lot_id, me)] <= cap
    # responded distributor untouched, unresponded ones never shrink
    for (lot, d), q in old_q.items():
        if d == other:
            assert new_q[(lot, d)] == q
        elif d != me:
            assert new_q.get((lot, d), 0) >= q
    assert {l.status for l in new.lines if l.to_id == me} <= {LineStatus.ACCEPTED, LineStatus.TRIMMED}
    assert all(l.status == LineStatus.PROPOSED for l in new.lines if l.to_id not in (me, other))
    assert elapsed < 8, elapsed   # PRD target is 3 s warm; MIP budget plus model build here


def test_rejecting_everything_ships_nothing_to_that_distributor(world):
    sc, snap, fc, plan = world
    me, mine, _ = _pick(plan)
    req = ResponseRequest(dist_id=me, proposal_version=1,
                          actions=[LineAction(line_id=l.line_id, action=ResponseAction.REJECT) for l in mine])
    new = apply_response(plan, _props(plan), req, sc, snap, fc)
    assert not [l for l in new.lines if l.to_id == me]
