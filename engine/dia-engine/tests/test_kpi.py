"""PRD 8.2 KPIs and 8.1 summary statistics."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from dia_engine import store
from dia_engine.baselines.baseline_a import BaselineA
from dia_engine.baselines.baseline_b import BaselineB
from dia_engine.data.generate import load_scenario
from dia_engine.sim import kpi, simulate
from dia_types import ExperimentResults, OpeningState


@pytest.fixture(autouse=True)
def _use_seed01(seed01, monkeypatch):
    monkeypatch.setenv("DIA_DATA_DIR", seed01)


@pytest.fixture(scope="module")
def measured(seed01):
    mp = pytest.MonkeyPatch()
    mp.setenv("DIA_DATA_DIR", seed01)
    try:
        sc = load_scenario("seed01")
        parts = []
        for seed in (1, 2):
            for pol in (BaselineA(), BaselineB(seed=seed)):
                log, trips = simulate.run_policy("seed01", pol, OpeningState.IMBALANCED, seed)
                parts.append(kpi.compute_kpis(log, trips, sc))
        yield pd.concat(parts, ignore_index=True), sc
    finally:
        mp.undo()


def test_compute_kpis_shape_and_ranges(measured):
    res, _ = measured
    assert list(res.columns) == store.TABLES["kpi_results"][1]
    assert set(res["kpi"]) == set(kpi.KPI_NAMES)
    assert len(res) == 4 * len(kpi.KPI_NAMES)
    v = res.pivot_table(index=["policy", "seed"], columns="kpi", values="value")
    assert v["fill_rate"].between(0.3, 1).all() and v["festival_fill_rate"].between(0.3, 1).all()
    assert v["stockout_rate"].between(0, 1).all() and v["cover_extremes"].between(0, 1).all()
    assert v["ftl_utilisation"].between(0.05, 1).all() and (v["freight_inr_per_case"] > 0).all()
    assert (v["cost_to_serve_inr"] >= v["lost_margin_inr"] + v["wastage_inr"]).all()
    assert v["co2_kg_per_case"].gt(0).all()


def test_baselines_differ_and_demand_side_kpis_are_policy_specific(measured):
    res, _ = measured
    v = res.pivot_table(index=["policy", "seed"], columns="kpi", values="value")
    assert v.loc["baseline_a", "fill_rate"].mean() != v.loc["baseline_b", "fill_rate"].mean()


def _synthetic(engine_shift: float):
    rng = np.random.default_rng(0)
    rows = []
    for state in ("neutral", "imbalanced"):
        for seed in range(1, 11):
            base = rng.normal(0, 0.005)
            for pol, fill, cost in (("baseline_a", 0.90, 100.0), ("baseline_b", 0.88, 90.0),
                                    ("engine", 0.90 + engine_shift, 80.0), ("abl_no_expiry", 0.90 + engine_shift, 95.0)):
                for name, val in (("fill_rate", fill + base + rng.normal(0, 0.002)),
                                  ("cost_to_serve_inr", cost + rng.normal(0, 1)), ("wastage_inr", cost / 10),
                                  (f"fill_rate@pi_mult=2", 0.93), (f"cost_to_serve_inr@pi_mult=2", 120.0)):
                    if "@" in name and pol != "engine":
                        continue
                    rows.append([pol, state, seed, name, val])
    return pd.DataFrame(rows, columns=store.TABLES["kpi_results"][1])


def test_summarise_picks_better_baseline_by_direction_and_paired_ci():
    out = kpi.summarise("EX-t", _synthetic(0.03))
    assert isinstance(out, ExperimentResults)
    eng = {(k.opening_state, k.kpi): k for k in out.kpis if k.policy == "engine"}
    fill = eng[("neutral", "fill_rate")]
    assert fill.n_seeds == 10 and fill.ci_low < fill.mean < fill.ci_high
    assert fill.delta_vs_best_baseline == pytest.approx(0.03, abs=0.004)       # best = baseline_a (higher)
    assert fill.delta_ci_low > 0                                                 # CI excludes zero, favourable
    cost = eng[("neutral", "cost_to_serve_inr")]
    assert cost.delta_vs_best_baseline == pytest.approx(80 - 90, abs=1.5)        # best = baseline_b (lower)
    assert all(k.delta_vs_best_baseline is None for k in out.kpis if k.policy != "engine")


def test_summarise_ablation_and_frontier_rows():
    out = kpi.summarise("EX-t", _synthetic(0.0))
    abl = {a.opening_state: a for a in out.ablation}
    assert abl["neutral"].variant == "abl_no_expiry"
    assert abl["neutral"].delta_cost_to_serve_inr == pytest.approx(15, abs=1.5)
    assert abl["neutral"].ci_low < abl["neutral"].delta_cost_to_serve_inr < abl["neutral"].ci_high
    assert len(out.frontier) == 2 and out.frontier[0].param == "pi_mult" and out.frontier[0].value == 2.0
    assert out.frontier[0].fill_rate == pytest.approx(0.93) and out.frontier[0].cost_to_serve_inr == pytest.approx(120)


def test_summarise_survives_missing_policies(measured):
    res, _ = measured
    out = kpi.summarise("EX-b", res)
    assert out.kpis and all(k.policy != "engine" for k in out.kpis) and not out.ablation and not out.frontier
