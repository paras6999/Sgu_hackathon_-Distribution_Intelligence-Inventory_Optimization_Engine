"""FR-21 stock trajectory: filtering and date ordering from a sim_log, and missing data."""
from __future__ import annotations

from datetime import date

import pandas as pd
import pytest

from dia_engine import store
from dia_engine.sim.trajectory import trajectory
from dia_types import OpeningState

EXP = "EX-TEST"
D1, D2 = date(2025, 10, 1), date(2025, 10, 2)


def _row(policy, day, node, sku, state, seed, closing):
    # columns: seed, policy, opening_state, date, node_id, sku_id, opening, receipts, sales, lost, expired,
    # credit_cut, closing
    return [seed, policy, state, day, node, sku, 0.0, 0.0, 3.0, 1.5, 0.25, 0.0, closing]


@pytest.fixture
def sim_log():
    rows = [
        _row("engine", D2, "D1-Pune", "SKU1", "imbalanced", 1, 20.0),
        _row("engine", D1, "D1-Pune", "SKU1", "imbalanced", 1, 30.0),
        _row("baseline_a", D1, "D1-Pune", "SKU1", "imbalanced", 1, 40.0),
        _row("engine", D1, "D2-Delhi", "SKU1", "imbalanced", 1, 50.0),
        _row("engine", D1, "D1-Pune", "SKU2", "imbalanced", 1, 60.0),
        _row("engine", D1, "D1-Pune", "SKU1", "neutral", 1, 70.0),
        _row("engine", D1, "D1-Pune", "SKU1", "imbalanced", 2, 80.0),
    ]
    store.write_table("sim_log", pd.DataFrame(rows, columns=store.TABLES["sim_log"][1]), EXP)


def test_filters_to_one_node_sku_state_and_seed_and_orders_points(sim_log):
    t = trajectory(EXP, "SKU1", "D1-Pune", "imbalanced", 1)
    assert (t.experiment_id, t.sku_id, t.dist_id, t.seed) == (EXP, "SKU1", "D1-Pune", 1)
    assert t.opening_state == OpeningState.IMBALANCED
    assert [s.policy for s in t.series] == ["baseline_a", "engine"]
    engine = next(s for s in t.series if s.policy == "engine")
    assert [p.date for p in engine.points] == [D1, D2]
    assert [p.closing_cases for p in engine.points] == [30.0, 20.0]
    assert (engine.points[0].sales_cases, engine.points[0].lost_cases, engine.points[0].expired_cases) == (3.0, 1.5, 0.25)
    baseline = next(s for s in t.series if s.policy == "baseline_a")
    assert [p.closing_cases for p in baseline.points] == [40.0]


def test_missing_experiment_raises_file_not_found():
    with pytest.raises(FileNotFoundError):
        trajectory("EX-MISSING", "SKU1", "D1-Pune", "imbalanced", 1)


def test_no_rows_for_the_selection_raises_file_not_found(sim_log):
    with pytest.raises(FileNotFoundError):
        trajectory(EXP, "SKU1", "D1-Pune", "imbalanced", 9)
