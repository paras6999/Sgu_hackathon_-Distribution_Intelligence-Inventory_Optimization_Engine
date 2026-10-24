"""FR-09 run_experiment: tables, results.json, frontier/ablation plumbing (baselines only, one seed, no solver)."""
from __future__ import annotations

import json

import pytest

from dia_engine import store
from dia_engine.sim import simulate
from dia_types import ExperimentRequest, ExperimentResults


@pytest.fixture(scope="module")
def experiment(seed01):
    mp = pytest.MonkeyPatch()
    mp.setenv("DIA_DATA_DIR", seed01)
    try:
        progress: list[float] = []
        req = ExperimentRequest(policies=["baseline_a", "baseline_b"], seeds=1, opening_states=["imbalanced"])
        simulate.run_experiment("EX-test", req, progress=progress.append)
        yield progress, ExperimentResults.model_validate(json.loads(store.results_path("EX-test").read_text(encoding="utf-8")))
    finally:
        mp.undo()


@pytest.fixture(autouse=True)
def _use_seed01(seed01, monkeypatch):
    monkeypatch.setenv("DIA_DATA_DIR", seed01)


def test_progress_runs_from_zero_to_one_hundred(experiment):
    progress, _ = experiment
    assert progress[0] == 0.0 and progress[-1] == 100.0


def test_tables_written_with_contract_columns(experiment):
    for name in ("kpi_results", "sim_log", "sim_trips"):
        df = store.read_table(name, "EX-test")
        assert list(df.columns) == store.TABLES[name][1] and len(df) > 0
    assert set(store.read_table("sim_log", "EX-test")["policy"]) == {"baseline_a", "baseline_b"}


def test_results_have_kpis_and_frontier_for_each_policy(experiment):
    _, res = experiment
    assert {k.policy.value for k in res.kpis} == {"baseline_a", "baseline_b"}
    assert {k.kpi for k in res.kpis} >= {"fill_rate", "cost_to_serve_inr", "wastage_inr"}
    pts = {(p.policy.value, p.param): sorted(q.value for q in res.frontier if (q.policy, q.param) == (p.policy, p.param))
           for p in res.frontier}
    assert pts[("baseline_a", "cover_days")] == [7, 10, 14, 21]
    assert pts[("baseline_b", "service_level")] == [0.8, 0.9, 0.95, 0.98, 0.995]


def test_more_cover_buys_fill_at_a_cost(experiment):
    _, res = experiment
    a = sorted((p for p in res.frontier if p.policy.value == "baseline_a"), key=lambda p: p.value)
    assert a[-1].fill_rate > a[0].fill_rate
