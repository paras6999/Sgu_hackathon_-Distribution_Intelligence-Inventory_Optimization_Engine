"""FR-19 what-if: default identity, depot outage, regional demand shock, diesel on freight rates."""
from __future__ import annotations

from datetime import date

import pytest

from dia_engine.config import get_config
from dia_engine.data.generate import load_scenario
from dia_engine.forecast.forecast import forecast
from dia_engine.optimize import validate
from dia_engine.optimize.pipeline import make_plan
from dia_engine.sim.simulate import get_snapshot
from dia_engine.whatif import apply_what_if
from dia_types import OpeningState, TempClass, WhatIf

T0 = date(2025, 9, 29)


@pytest.fixture(autouse=True)
def _use_seed01(seed01, monkeypatch):
    monkeypatch.setenv("DIA_DATA_DIR", seed01)


@pytest.fixture(scope="module")
def world(seed01):
    mp = pytest.MonkeyPatch()
    mp.setenv("DIA_DATA_DIR", seed01)
    try:
        yield load_scenario("seed01"), get_snapshot("seed01", T0, OpeningState.IMBALANCED), forecast("seed01", T0)
    finally:
        mp.undo()


def test_defaults_return_the_same_objects(world):
    out = apply_what_if(*world, WhatIf())
    assert all(a is b for a, b in zip(out, world))


def test_outage_removes_exactly_the_depots_lots(world):
    sc, snap, fc = world
    depot = snap.depot_lots[0].depot_id
    before = [lot.lot_id for lot in snap.depot_lots]
    _, out, _ = apply_what_if(sc, snap, fc, WhatIf(depot_outage_id=depot))
    assert [lot.lot_id for lot in out.depot_lots] == [lot.lot_id for lot in snap.depot_lots if lot.depot_id != depot]
    assert len(out.depot_lots) < len(before)
    assert [lot.lot_id for lot in snap.depot_lots] == before
    assert out.dist_stock == snap.dist_stock


def test_demand_shock_changes_only_the_chosen_region(world):
    sc, snap, fc = world
    region_of = {n.node_id: n.region for n in sc.nodes}
    before = {(p.sku_id, p.dist_id): p for p in fc.pairs}
    _, _, out = apply_what_if(sc, snap, fc, WhatIf(demand_shock_pct=20, shock_region="N"))
    shocked = 0
    for pf in out.pairs:
        old = before[(pf.sku_id, pf.dist_id)]
        if region_of[pf.dist_id] == "N":
            shocked += 1
            assert pf.mean == pytest.approx([m * 1.2 for m in old.mean])
            assert pf.var == pytest.approx([v * 1.2 ** 2 for v in old.var])
        else:
            assert pf.mean == old.mean and pf.var == old.var
    assert shocked > 0


def test_diesel_scales_lane_freight_rates_only(world):
    sc, snap, fc = world
    factor = 1 + get_config().costs.ptl.fuel_share * 10 / 100
    before = [(dict(lane.ftl_cost_inr), lane.ptl_rate_inr_per_kg, lane.ptl_min_charge_inr) for lane in sc.lanes]
    out, _, _ = apply_what_if(sc, snap, fc, WhatIf(diesel_pct=10))
    for lane, new, (ftl, rate, minimum) in zip(sc.lanes, out.lanes, before):
        assert new.ftl_cost_inr == pytest.approx({k: v * factor for k, v in ftl.items()})
        assert new.ptl_rate_inr_per_kg == pytest.approx(rate * factor)
        assert new.ptl_min_charge_inr == pytest.approx(minimum * factor)
    assert out.skus == sc.skus
    assert [(dict(lane.ftl_cost_inr), lane.ptl_rate_inr_per_kg, lane.ptl_min_charge_inr) for lane in sc.lanes] == before


def test_plan_with_diesel_shock_validates(world):
    sc, snap, fc = apply_what_if(*world, WhatIf(diesel_pct=10))
    plan = make_plan(sc, snap, fc, TempClass.AMBIENT, plan_id="PL-WHATIF")
    assert validate.validate_plan(plan, sc, snap, []).ok
