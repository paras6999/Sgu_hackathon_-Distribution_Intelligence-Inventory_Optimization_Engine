"""Baseline checks (FR-10): every plan obeys the same limits as the engine, plus policy-specific behaviour.

`check_limits` is a small independent checker so baselines are verified before M1's validator lands;
once it does, test_contracts also runs validate_plan on these plans.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date

import pytest

from dia_engine.baselines.baseline_a import BaselineA, _fair_share
from dia_engine.config import get_config
from dia_types import (
    DistStock, ForecastBundle, Lot, Plan, Scenario, ShipMode, Snapshot, TempClass, TruckClass, load_fixture,
)


def _fx():
    return load_fixture("scenario", Scenario), load_fixture("snapshot", Snapshot), load_fixture("forecast", ForecastBundle)


def check_limits(plan: Plan, scenario: Scenario, snapshot: Snapshot) -> None:
    cfg = get_config()
    skus = {s.sku_id: s for s in scenario.skus}
    lots = {l.lot_id: l for l in snapshot.depot_lots}
    lanes = {(l.from_id, l.to_id): l for l in scenario.lanes}
    used = defaultdict(float)
    m3 = defaultdict(float)
    value = defaultdict(float)
    for l in plan.lines:
        lot, sku = lots[l.lot_id], skus[l.sku_id]
        assert lot.depot_id == l.from_id and lot.sku_id == l.sku_id
        assert l.cases > 0 and (l.truck_id or l.consignment_id)
        used[l.lot_id] += l.cases
        m3[l.to_id] += l.cases * sku.m3_per_case
        value[l.to_id] += l.cases * sku.price_inr
        rsl = (lot.expiry_date - snapshot.as_of).days - math.ceil(lanes[(l.from_id, l.to_id)].lead_days_mean)
        assert rsl >= cfg.planning.mrsl_fraction["GT"] * sku.shelf_life_days, l.line_id
    for lot_id, n in used.items():
        assert n <= lots[lot_id].qty_cases + 1e-9
    for j in m3:
        assert m3[j] <= snapshot.storage_free_m3[j] + 1e-6
        assert value[j] <= snapshot.credit_available_inr[j] + 1e-6
    by_id = {l.line_id: l for l in plan.lines}
    for t in plan.trucks:
        if t.mode is ShipMode.FTL:
            cap = cfg.costs.ftl[t.truck_class.value]
            assert t.kg <= cap.kg + 1e-6 and t.m3 <= cap.m3 + 1e-6
        assert math.isclose(sum(by_id[i].freight_alloc_inr for i in t.line_ids), t.cost_inr, abs_tol=0.05 * len(t.line_ids))
    assert {i for t in plan.trucks for i in t.line_ids} == set(by_id)


@pytest.mark.parametrize("temp_class", [TempClass.AMBIENT, TempClass.CHILLED])
def test_baseline_a_obeys_limits(temp_class):
    sc, snap, fc = _fx()
    plan = BaselineA().plan(sc, snap, fc, temp_class)
    assert plan.policy.value == "baseline_a" and plan.lines
    check_limits(plan, sc, snap)
    if temp_class is TempClass.CHILLED:
        assert all(t.mode is ShipMode.FTL and t.truck_class is TruckClass.REEF17 for t in plan.trucks)


def test_baseline_a_only_home_region_and_fifo():
    sc, snap, fc = _fx()
    plan = BaselineA().plan(sc, snap, fc, TempClass.AMBIENT)
    home = {n.node_id: n.home_depot_id for n in sc.nodes}
    assert all(home[l.to_id] == l.from_id for l in plan.lines)


def test_baseline_a_caps_at_cover():
    sc, snap, fc = _fx()
    plan = BaselineA(cover_days=7).plan(sc, snap, fc, TempClass.AMBIENT)
    demand = {(p.sku_id, p.dist_id): sum(p.mean[:7]) for p in fc.pairs}
    shipped = defaultdict(int)
    for l in plan.lines:
        shipped[(l.sku_id, l.to_id)] += l.cases
    stock = defaultdict(float)
    for s in snap.dist_stock:
        stock[(s.sku_id, s.dist_id)] += s.qty_cases
    for k, n in shipped.items():
        assert n <= demand[k] - stock[k] + 1


def test_scarce_stock_splits_in_proportion():
    sc, snap, fc = _fx()
    # Hosur holds only 60 cases of SN-01 for Bengaluru (20/day) and Coimbatore (12/day).
    lots = [l for l in snap.depot_lots if l.lot_id != "HSR-SN01-0388"] + [
        Lot(lot_id="HSR-SN01-0388", sku_id="SN-01", depot_id="S1-Hosur", qty_cases=60,
            mfg_date=date(2025, 8, 30), expiry_date=date(2025, 12, 28))]
    plan = BaselineA().plan(sc, snap.model_copy(update={"depot_lots": lots}), fc, TempClass.AMBIENT)
    got = defaultdict(int)
    for l in plan.lines:
        if l.sku_id == "SN-01" and l.from_id == "S1-Hosur":
            got[l.to_id] += l.cases
    assert sum(got.values()) <= 60 and sum(got.values()) >= 58
    assert got["D09-Bengaluru"] > got["D10-Coimbatore"] > 0


def test_credit_cuts_pro_rata():
    sc, snap, fc = _fx()
    tight = snap.model_copy(update={"credit_available_inr": {**snap.credit_available_inr, "D01-Pune": 100_000}})
    plan = BaselineA().plan(sc, tight, fc, TempClass.AMBIENT)
    check_limits(plan, sc, tight)
    assert sum(l.cases for l in plan.lines if l.to_id == "D01-Pune") > 0


def test_mrsl_blocks_short_lots():
    sc, snap, fc = _fx()
    short = [l.model_copy(update={"expiry_date": date(2025, 11, 1)}) if l.sku_id == "SN-01" else l for l in snap.depot_lots]
    plan = BaselineA().plan(sc, snap.model_copy(update={"depot_lots": short}), fc, TempClass.AMBIENT)
    assert not [l for l in plan.lines if l.sku_id == "SN-01"]


def test_fair_share_redistributes_capped_surplus():
    alloc = _fair_share(100, {"a": 1, "b": 1}, {"a": 10, "b": 500})
    assert alloc["a"] == pytest.approx(10) and alloc["b"] == pytest.approx(90)


def test_stock_already_at_distributor_reduces_need():
    sc, snap, fc = _fx()
    full = snap.model_copy(update={"dist_stock": [DistStock(dist_id="D01-Pune", sku_id="HC-02", lot_id="X", qty_cases=10_000,
                                                            expiry_date=date(2027, 1, 1))]})
    plan = BaselineA().plan(sc, full, fc, TempClass.AMBIENT)
    assert not [l for l in plan.lines if l.sku_id == "HC-02" and l.to_id == "D01-Pune"]
