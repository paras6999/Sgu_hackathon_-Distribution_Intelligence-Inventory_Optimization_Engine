"""FR-09 run_policy: conservation, common random numbers, credit cuts, determinism (baselines only; no solver)."""
from __future__ import annotations

import pytest

from dia_engine.baselines.baseline_a import BaselineA
from dia_engine.baselines.baseline_b import BaselineB
from dia_engine.sim import simulate
from dia_engine import store
from dia_types import OpeningState


@pytest.fixture(autouse=True)
def _use_seed01(seed01, monkeypatch):
    monkeypatch.setenv("DIA_DATA_DIR", seed01)


@pytest.fixture(scope="module")
def runs(seed01):
    mp = pytest.MonkeyPatch()
    mp.setenv("DIA_DATA_DIR", seed01)
    try:
        b1 = simulate.run_policy("seed01", BaselineB(seed=1), OpeningState.IMBALANCED, 1)
        b2 = simulate.run_policy("seed01", BaselineB(seed=1), OpeningState.IMBALANCED, 1)
        a = simulate.run_policy("seed01", BaselineA(), OpeningState.NEUTRAL, 1)
        yield b1, b2, a
    finally:
        mp.undo()


def test_tables_match_the_store_contract(runs):
    for log, trips in (runs[0], runs[2]):
        assert list(log.columns) == store.TABLES["sim_log"][1]
        assert list(trips.columns) == store.TABLES["sim_trips"][1]
        assert log["date"].nunique() == 84 and len(trips) > 0


def test_conservation_holds_on_every_row(runs):
    # run_policy raises SimulationError on a failure; re-check the logged rows independently
    for log, _ in (runs[0], runs[2]):
        gap = log["opening"] + log["receipts"] - log["sales"] - log["expired"] - log["closing"]
        assert (gap == 0).all() and (log[["opening", "closing", "sales", "lost", "expired"]] >= 0).all().all()


def test_common_random_numbers_same_demand_for_every_policy(runs):
    def demand(log):
        d = log[log["node_id"].str.startswith("D")]
        return (d["sales"] + d["lost"]).to_numpy()
    assert (demand(runs[0][0]) == demand(runs[2][0])).all()


def test_deterministic(runs):
    (l1, t1), (l2, t2) = runs[0], runs[1]
    assert l1.equals(l2) and t1.equals(t2)


def test_opening_states_differ(runs):
    first = runs[0][0][runs[0][0]["date"] == runs[0][0]["date"].min()]
    neutral = runs[2][0][runs[2][0]["date"] == runs[2][0]["date"].min()]
    assert first["opening"].sum() != neutral["opening"].sum() or not first["opening"].equals(neutral["opening"])


def test_credit_cut_is_pro_rata_and_logged(seed01):
    from dia_engine.optimize.freight import festival_premium  # noqa: F401  (import check only)
    from dia_types import Snapshot
    from dia_engine.data.generate import load_scenario
    sc = load_scenario("seed01")
    skus = {s.sku_id: s for s in sc.skus}
    snap = simulate.get_snapshot("seed01", simulate.get_config().simulation.test_window[0], OpeningState.NEUTRAL)
    plan = BaselineA().plan(sc, snap, simulate.forecast("seed01", snap.as_of), simulate.TempClass.AMBIENT)
    dist = plan.lines[0].to_id
    before = sum(l.cases * skus[l.sku_id].price_inr for l in plan.lines if l.to_id == dist)
    tight = snap.model_copy(update={"credit_available_inr": {**snap.credit_available_inr, dist: before / 2}})
    cut: dict = {}
    from collections import defaultdict
    cut = defaultdict(int)
    out = simulate._enforce_credit(plan, tight, skus, cut)
    after = sum(l.cases * skus[l.sku_id].price_inr for l in out.lines if l.to_id == dist)
    assert after <= before / 2 + 1e-6 and after > 0.4 * before and sum(cut.values()) > 0
    assert sum(l.cases for l in plan.lines) - sum(l.cases for l in out.lines) == sum(cut.values())
    assert {l.truck_id or l.consignment_id for l in out.lines} == {t.truck_id for t in out.trucks}
