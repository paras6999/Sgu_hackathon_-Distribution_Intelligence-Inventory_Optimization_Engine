"""FR-20 at-risk stock: ordering, keep rule, days left and suggested action on seed01 imbalanced stock."""
from __future__ import annotations

from datetime import date

import pytest

from dia_engine.at_risk import at_risk
from dia_engine.data.generate import load_scenario
from dia_engine.forecast.forecast import forecast
from dia_engine.sim.simulate import get_snapshot
from dia_types import OpeningState

T0 = date(2025, 9, 29)


@pytest.fixture(autouse=True)
def _use_seed01(seed01, monkeypatch):
    monkeypatch.setenv("DIA_DATA_DIR", seed01)


@pytest.fixture(scope="module")
def rows(seed01):
    mp = pytest.MonkeyPatch()
    mp.setenv("DIA_DATA_DIR", seed01)
    try:
        sc = load_scenario("seed01")
        snap = get_snapshot("seed01", T0, OpeningState.IMBALANCED)
        # get_snapshot leaves lot_id unset on distributor stock; at_risk only lists lots, so give each row an id
        snap = snap.model_copy(update={"dist_stock": [d.model_copy(update={"lot_id": f"DL-{k:05d}"})
                                                      for k, d in enumerate(snap.dist_stock)]})
        return at_risk(sc, snap, forecast("seed01", T0), T0, limit=1000)
    finally:
        mp.undo()


def test_rows_are_sorted_by_expected_expired_cases_descending(rows):
    assert rows
    expired = [r.expected_expired_cases for r in rows]
    assert expired == sorted(expired, reverse=True)


def test_distributor_rows_sell_too_slowly_for_their_shelf_life_or_are_past_expiry(rows):
    dist = [r for r in rows if r.holder_type == "distributor"]
    assert all(r.days_left <= 0 or r.expected_days_to_sell > r.days_left for r in dist)


def test_depot_rows_are_listed_at_depots_and_include_the_floor_cases(rows):
    depot = [r for r in rows if r.holder_type == "depot"]
    assert depot, "seed01 imbalanced stock at 2025-09-29 has depot lots near the shelf-life floor"
    assert all(r.dist_id.split("-")[0] in {"W1", "N1", "S1", "E1"} for r in depot)
    assert any(r.suggested_action.startswith("Ship within") for r in depot)


def test_days_left_is_expiry_minus_as_of(rows):
    assert all(r.days_left == (r.expiry - T0).days for r in rows)


def test_every_row_has_a_suggested_action(rows):
    assert all(r.suggested_action.strip() for r in rows)
