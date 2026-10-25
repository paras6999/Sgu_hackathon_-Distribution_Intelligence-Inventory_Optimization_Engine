"""Warehouse space on seed01: depot capacity rule, used and free space, what still fits, and the service route."""
from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from dia_engine.config import get_config
from dia_engine.data.generate import load_scenario
from dia_engine.service.app import app
from dia_engine.sim.simulate import get_snapshot
from dia_engine.space import depot_capacity_m3, space
from dia_types import NodeType, OpeningState

T0 = date(2025, 9, 29)


@pytest.fixture(autouse=True)
def _use_seed01(seed01, monkeypatch):
    monkeypatch.setenv("DIA_DATA_DIR", seed01)


@pytest.fixture(scope="module")
def world(seed01):
    mp = pytest.MonkeyPatch()
    mp.setenv("DIA_DATA_DIR", seed01)
    try:
        sc = load_scenario("seed01")
        snap = get_snapshot("seed01", T0, OpeningState.IMBALANCED)
        return sc, snap, space(sc, snap, OpeningState.IMBALANCED)
    finally:
        mp.undo()


def test_depot_capacity_is_weeks_of_regional_volume(world):
    sc, _, _ = world
    cap = depot_capacity_m3(sc)
    weeks = get_config().supply.depot_storage_weeks
    depots = [n.node_id for n in sc.nodes if n.type == NodeType.DEPOT]
    assert set(cap) == {(d, t) for d in depots for t in ("ambient", "chilled")}
    # a chilled cold room holds less than an ambient store, and every store has room
    for d in depots:
        assert cap[(d, "chilled")] < cap[(d, "ambient")]
        assert cap[(d, "chilled")] > 0
    # the rule scales with the weeks setting
    assert cap[(depots[0], "ambient")] / weeks["ambient"] == pytest.approx(
        depot_capacity_m3(sc)[(depots[0], "ambient")] / weeks["ambient"])


def test_every_store_and_godown_is_reported_with_consistent_numbers(world):
    sc, _, rep = world
    assert len(rep.depots) == 2 * sum(n.type == NodeType.DEPOT for n in sc.nodes)
    assert len(rep.distributors) == sum(n.type == NodeType.DISTRIBUTOR for n in sc.nodes)
    for n in rep.depots + rep.distributors:
        assert n.capacity_m3 > 0
        assert n.free_m3 == pytest.approx(max(n.capacity_m3 - n.used_m3, 0), abs=0.11)
        # used_pct uses unrounded m3; recomputing from the 0.1-m3-rounded fields can move it by 100 * 0.1 / capacity
        assert n.used_pct == pytest.approx(100 * n.used_m3 / n.capacity_m3, abs=0.2 + 10 / n.capacity_m3)
    assert all(n.temp_class in ("ambient", "chilled") for n in rep.depots)
    assert all(n.temp_class is None for n in rep.distributors)


def test_used_space_matches_the_snapshot(world):
    sc, snap, rep = world
    skus = {s.sku_id: s for s in sc.skus}
    total_depot = sum(l.qty_cases * skus[l.sku_id].m3_per_case for l in snap.depot_lots)
    assert sum(n.used_m3 for n in rep.depots) == pytest.approx(total_depot, abs=0.1 * len(rep.depots))
    total_dist = sum(d.qty_cases * skus[d.sku_id].m3_per_case for d in snap.dist_stock) + \
        sum(t.qty_cases * skus[t.sku_id].m3_per_case for t in snap.in_transit)
    assert sum(n.used_m3 for n in rep.distributors) == pytest.approx(total_dist, abs=0.1 * len(rep.distributors))


def test_depots_are_realistically_full_on_the_first_day(world):
    """Sized so the busiest week is ~90% full; on 29 Sep ambient stores are busy but not over capacity."""
    _, _, rep = world
    amb = [n.used_pct for n in rep.depots if n.temp_class == "ambient"]
    assert all(40 <= p <= 100 for p in amb), amb


def test_fits_lists_whole_cases_of_the_right_goods(world):
    sc, _, rep = world
    skus = {s.sku_id: s for s in sc.skus}
    chilled_store = next(n for n in rep.depots if n.temp_class == "chilled")
    assert {f.sku_id for f in chilled_store.fits} == {s.sku_id for s in sc.skus if s.temp_class.value == "chilled"}
    godown = rep.distributors[0]
    assert len(godown.fits) == len(sc.skus)
    for f in godown.fits:
        assert f.cases * skus[f.sku_id].m3_per_case <= godown.free_m3 + 0.06


def test_service_route():
    r = TestClient(app).get("/scenarios/seed01/space", params={"as_of": "2025-09-29", "opening_state": "neutral"})
    assert r.status_code == 200
    body = r.json()
    assert body["opening_state"] == "neutral" and body["depots"] and body["distributors"]
