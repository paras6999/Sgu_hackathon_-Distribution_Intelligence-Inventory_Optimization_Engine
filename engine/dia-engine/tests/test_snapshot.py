"""FR-09 opening states: neutral = forecast x target cover; imbalanced = the three deliberate stresses."""
from __future__ import annotations

from collections import defaultdict
from datetime import date

import pytest

from dia_engine import store
from dia_engine.config import get_config
from dia_engine.data.generate import load_scenario
from dia_engine.sim import simulate
from dia_types import NodeType, OpeningState, Snapshot

T0 = date(2025, 9, 29)


@pytest.fixture(autouse=True)
def _use_seed01(seed01, monkeypatch):
    monkeypatch.setenv("DIA_DATA_DIR", seed01)


@pytest.fixture(scope="module")
def snaps(seed01):
    mp = pytest.MonkeyPatch()
    mp.setenv("DIA_DATA_DIR", seed01)
    try:
        yield (simulate.get_snapshot("seed01", T0, OpeningState.NEUTRAL),
               simulate.get_snapshot("seed01", T0, OpeningState.IMBALANCED), load_scenario("seed01"))
    finally:
        mp.undo()


def _held(snap: Snapshot):
    out = defaultdict(float)
    for d in snap.dist_stock:
        out[d.dist_id] += d.qty_cases
    return out


def test_neutral_is_cover_and_within_limits(snaps):
    neutral, _, sc = snaps
    skus = {s.sku_id: s for s in sc.skus}
    dists = [n for n in sc.nodes if n.type == NodeType.DISTRIBUTOR]
    assert neutral.in_transit == []
    assert len(neutral.dist_stock) > 0.9 * len(skus) * len(dists)
    for n in dists:
        held = sum(d.qty_cases * skus[d.sku_id].m3_per_case for d in neutral.dist_stock if d.dist_id == n.node_id)
        assert held <= n.storage_m3 and 0 < neutral.storage_free_m3[n.node_id] < n.storage_m3
        assert 0 < neutral.credit_available_inr[n.node_id] <= n.credit_limit_inr
    assert all(d.expiry_date > T0 for d in neutral.dist_stock)


def test_depot_lots_unchanged_in_neutral(snaps):
    neutral, _, _ = snaps
    table = store.read_table("lots", "seed01")
    assert len(neutral.depot_lots) == len(table)
    assert sum(l.qty_cases for l in neutral.depot_lots) == table["qty_cases"].sum()


def test_imbalanced_aged_snack_lots(snaps):
    neutral, imb, sc = snaps
    skus = {s.sku_id: s for s in sc.skus}
    depot = next(n.node_id for n in sc.nodes if n.type == NodeType.DEPOT and n.region == simulate.AGED_DEPOT_REGION)
    mrsl = get_config().planning.mrsl_fraction["GT"]
    aged = [l for l in imb.depot_lots if l.depot_id == depot and skus[l.sku_id].category == "snacks"]
    assert aged
    for l in aged:
        rsl = (l.expiry_date - T0).days / skus[l.sku_id].shelf_life_days
        assert 0.61 <= rsl <= 0.71 and rsl > mrsl
    before = {l.lot_id: l for l in neutral.depot_lots}
    changed = {l.lot_id for l in imb.depot_lots if l != before[l.lot_id]}
    assert changed == {l.lot_id for l in aged}


def test_imbalanced_short_region_and_overstock(snaps):
    neutral, imb, sc = snaps
    region = {n.node_id: n.region for n in sc.nodes}
    pop = {d.id: d.population_m for d in get_config().catalogue.distributors}
    n_stock, i_stock = _held(neutral), _held(imb)
    north = [j for j in n_stock if region[j] == simulate.SHORT_REGION]
    assert all(i_stock[j] < 0.75 * n_stock[j] for j in north)
    small = min((j for j in n_stock if region[j] == simulate.OVERSTOCK_REGION), key=pop.get)
    per_sku = {d.sku_id: d.qty_cases for d in neutral.dist_stock if d.dist_id == small}
    slow = [d for d in imb.dist_stock if d.dist_id == small and d.qty_cases > 2 * per_sku.get(d.sku_id, 0)]
    assert len(slow) >= 3 and i_stock[small] > n_stock[small]
    assert imb.storage_free_m3[small] < neutral.storage_free_m3[small]
    assert all(i_stock[j] == n_stock[j] for j in n_stock if j not in north and j != small)


def test_later_day_not_implemented_and_deterministic(snaps, seed01):
    with pytest.raises(NotImplementedError):
        simulate.get_snapshot("seed01", date(2025, 10, 6))
    assert simulate.get_snapshot("seed01", T0, OpeningState.IMBALANCED) == snaps[1]
