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


def test_every_row_is_expected_to_expire_or_already_past_expiry(rows):
    assert all(r.expected_expired_cases >= 0.5 or r.days_left <= 0 for r in rows)


def test_days_left_is_expiry_minus_as_of(rows):
    assert all(r.days_left == (r.expiry - T0).days for r in rows)


def test_every_row_has_a_suggested_action(rows):
    assert all(r.suggested_action.strip() for r in rows)
