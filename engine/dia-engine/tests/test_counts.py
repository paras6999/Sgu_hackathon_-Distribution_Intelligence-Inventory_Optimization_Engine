"""Counted stock: lots are scaled to the count, unknown stock gets a lot, godown space follows, and plans use it."""
from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from dia_engine.counts import apply_counts
from dia_engine.data.generate import load_scenario
from dia_engine.service.app import app
from dia_engine.sim.simulate import get_snapshot
from dia_types import OpeningState, StockCount

T0 = date(2025, 9, 29)


@pytest.fixture(autouse=True)
def _use_seed01(seed01, monkeypatch):
    monkeypatch.setenv("DIA_DATA_DIR", seed01)


@pytest.fixture(scope="module")
def world(seed01):
    mp = pytest.MonkeyPatch()
    mp.setenv("DIA_DATA_DIR", seed01)
    try:
        return load_scenario("seed01"), get_snapshot("seed01", T0, OpeningState.IMBALANCED)
    finally:
        mp.undo()


def test_no_counts_changes_nothing(world):
    sc, snap = world
    assert apply_counts(sc, snap, []) is snap


def test_depot_lots_are_scaled_to_the_count_keeping_expiry_order(world):
    sc, snap = world
    lot = max(snap.depot_lots, key=lambda l: l.qty_cases)
    before = [l for l in snap.depot_lots if l.depot_id == lot.depot_id and l.sku_id == lot.sku_id]
    total = sum(l.qty_cases for l in before)
    out = apply_counts(sc, snap, [StockCount(node_id=lot.depot_id, sku_id=lot.sku_id, cases=total / 2)])
    after = [l for l in out.depot_lots if l.depot_id == lot.depot_id and l.sku_id == lot.sku_id]
    assert sum(l.qty_cases for l in after) == pytest.approx(total / 2)
    assert [l.expiry_date for l in after] == [l.expiry_date for l in before]
    others = [l for l in out.depot_lots if not (l.depot_id == lot.depot_id and l.sku_id == lot.sku_id)]
    assert len(others) == len(snap.depot_lots) - len(before)


def test_counting_zero_removes_the_stock_and_frees_godown_space(world):
    sc, snap = world
    d = max(snap.dist_stock, key=lambda x: x.qty_cases)
    out = apply_counts(sc, snap, [StockCount(node_id=d.dist_id, sku_id=d.sku_id, cases=0)])
    assert not [x for x in out.dist_stock if x.dist_id == d.dist_id and x.sku_id == d.sku_id]
    assert out.storage_free_m3[d.dist_id] > snap.storage_free_m3[d.dist_id]


def test_stock_the_system_did_not_know_gets_a_counted_lot(world):
    sc, snap = world
    have = {(x.dist_id, x.sku_id) for x in snap.dist_stock if x.qty_cases > 0}
    dist, sku = next((n.node_id, s) for n in sc.nodes if n.type.value == "distributor"
                     for s in sc.skus if (n.node_id, s.sku_id) not in have)
    out = apply_counts(sc, snap, [StockCount(node_id=dist, sku_id=sku.sku_id, cases=40)])
    new = [x for x in out.dist_stock if x.dist_id == dist and x.sku_id == sku.sku_id]
    assert len(new) == 1 and new[0].qty_cases == 40 and new[0].lot_id.startswith("COUNTED-")
    assert new[0].expiry_date > T0


def test_unknown_node_is_rejected(world):
    sc, snap = world
    with pytest.raises(ValueError):
        apply_counts(sc, snap, [StockCount(node_id="NOPE", sku_id=sc.skus[0].sku_id, cases=1)])


def test_plan_and_space_routes_use_counts(world):
    sc, snap = world
    client = TestClient(app)
    d = max(snap.dist_stock, key=lambda x: x.qty_cases)
    body = {"scenario_id": "seed01", "as_of": "2025-09-29", "temp_class": "ambient", "opening_state": "imbalanced", "plan_id": "PL-T"}
    sku_temp = {s.sku_id: s.temp_class.value for s in sc.skus}
    if sku_temp[d.sku_id] != "ambient":
        d = max((x for x in snap.dist_stock if sku_temp[x.sku_id] == "ambient"), key=lambda x: x.qty_cases)
    base = client.post("/plan", json=body)
    counted = client.post("/plan", json={**body, "stock_counts": [{"node_id": d.dist_id, "sku_id": d.sku_id, "cases": 0}]})
    assert base.status_code == 200 and counted.status_code == 200
    shipped = lambda p: sum(l["cases"] for l in p["lines"] if l["to_id"] == d.dist_id and l["sku_id"] == d.sku_id)
    # with the shelf counted empty, the plan sends at least as much of that product there
    assert shipped(counted.json()) >= shipped(base.json())
    r = client.post("/scenarios/seed01/space", json={"as_of": "2025-09-29", "stock_counts": [{"node_id": d.dist_id, "sku_id": d.sku_id, "cases": 0}]})
    assert r.status_code == 200
    plain = client.get("/scenarios/seed01/space", params={"as_of": "2025-09-29"}).json()
    used = lambda rep: next(n["used_m3"] for n in rep["distributors"] if n["node_id"] == d.dist_id)
    assert used(r.json()) < used(plain)
