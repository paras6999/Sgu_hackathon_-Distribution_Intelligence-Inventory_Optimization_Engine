"""Realism checks for the synthetic data (docs/Rules.md, "Simulated data must be realistic, not random").

A failing check is a generator or config bug, not a test to loosen. Ranges come from PRD 2.3 / 2.7 / 8.2.
"""
from __future__ import annotations

import hashlib

import pytest

from dia_engine import store
from dia_engine.config import get_config
from dia_engine.data.generate import generate, summary


@pytest.fixture()
def stats(seed01, monkeypatch) -> dict[str, float]:
    monkeypatch.setenv("DIA_DATA_DIR", seed01)
    return summary("seed01")


def test_distributor_turnover_in_segment(stats):
    assert 1.5 <= stats["revenue_per_distributor_cr_per_year"] <= 8.0     # PRD 2.7: Rs 300-3,000 cr brands


def test_diwali_lifts_snacks(stats):
    assert stats["diwali_snacks_uplift"] >= 1.25


def test_beverages_peak_in_summer(stats):
    assert 1.3 <= stats["beverage_may_vs_dec"] <= 3.0


def test_history_stockout_rate(stats):
    assert 0.03 <= stats["history_stockout_rate"] <= 0.08                  # NielsenIQ ~4% .. Gruen ~8.3%


def test_weekly_ambient_load_is_truck_scale(stats):
    assert 3.0 <= stats["ambient_tonnes_per_distributor_week"] <= 14.0     # 32 ft SXL = 7 t


def test_sunday_is_quieter(stats):
    assert stats["sunday_vs_monday"] < 0.8


def test_sku_economics(seed01, monkeypatch):
    monkeypatch.setenv("DIA_DATA_DIR", seed01)
    skus = store.read_table("skus", "seed01")
    assert (skus["price_inr"] > skus["landed_cost_inr"]).all() and (skus["landed_cost_inr"] > 0).all()
    gm = skus["margin_inr"] / skus["price_inr"]
    assert gm.between(0.15, 0.55).all()
    chilled = skus[skus["temp_class"] == "chilled"]["shelf_life_days"]
    assert chilled.between(10, 21).all()                                   # PRD A4


def test_opening_lots_are_usable(seed01, monkeypatch):
    monkeypatch.setenv("DIA_DATA_DIR", seed01)
    lots = store.read_table("lots", "seed01")
    t0 = get_config().simulation.test_window[0]
    assert (lots["expiry_date"] > t0).all() and (lots["qty_cases"] > 0).all()


def test_same_seed_same_data(tmp_path, monkeypatch):
    digests = []
    for run in ("a", "b"):
        monkeypatch.setenv("DIA_DATA_DIR", str(tmp_path / run))
        generate(get_config(), 3)
        df = store.read_table("demand_daily", "seed03")
        digests.append(hashlib.sha256(df.to_csv(index=False).encode()).hexdigest())
    assert digests[0] == digests[1]
