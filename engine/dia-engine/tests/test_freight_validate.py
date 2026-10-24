"""optimize/freight.py and optimize/validate.py: freight rules (A11-A14), load build, and every validator check."""
from __future__ import annotations

from datetime import date

import pytest

from dia_engine.baselines.baseline_a import BaselineA
from dia_engine.baselines.baseline_b import BaselineB
from dia_engine.optimize import freight
from dia_engine.optimize.validate import validate_plan
from dia_types import (
    ForecastBundle, LineStatus, Lock, Plan, PlanLine, Scenario, ShipMode, Snapshot, TempClass, TruckClass, load_fixture,
)


def _fx():
    return load_fixture("scenario", Scenario), load_fixture("snapshot", Snapshot), load_fixture("plan", Plan)


def _lane(sc: Scenario, w: str, j: str):
    return next(l for l in sc.lanes if l.from_id == w and l.to_id == j)


# --------------------------------------------------------------------------- freight

def test_trip_cost_has_festival_premium_only_in_season():
    sc, _, _ = _fx()
    lane = _lane(sc, "W1-Bhiwandi", "D01-Pune")
    base = lane.ftl_cost_inr["AMB32"]
    assert freight.ftl_trip_cost(lane, TruckClass.AMB32, date(2025, 10, 13)) == pytest.approx(base * 1.2)
    assert freight.ftl_trip_cost(lane, TruckClass.AMB32, date(2025, 3, 3)) == pytest.approx(base)


def test_ptl_minimum_and_volumetric_weight():
    sc, _, _ = _fx()
    lane = _lane(sc, "S1-Hosur", "D09-Bengaluru")
    assert freight.ptl_cost(lane, 10, 0.01, date(2025, 10, 13)) == lane.ptl_min_charge_inr
    # 400 kg but 4 m3 -> 1000 kg chargeable at 250 kg/m3
    assert freight.ptl_cost(lane, 400, 4.0, date(2025, 10, 13)) == pytest.approx(lane.ptl_rate_inr_per_kg * 1000)
    assert freight.ptl_cost(lane, 0, 0, date(2025, 10, 13)) == 0


def test_trips_needed_uses_the_binding_dimension():
    assert freight.trips_needed(6900, 10, TruckClass.AMB32) == 1
    assert freight.trips_needed(7001, 10, TruckClass.AMB32) == 2
    assert freight.trips_needed(100, 56, TruckClass.AMB32) == 2          # volume binds (55 m3)
    assert freight.trips_needed(0, 0, TruckClass.AMB32) == 0


def _line(i: int, sku: str, lot: str, w: str, j: str, cases: int) -> PlanLine:
    return PlanLine(line_id=f"PL-T-v1-{i:03d}", sku_id=sku, sku_name=sku, lot_id=lot, expiry=date(2027, 7, 1),
                    from_id=w, to_id=j, cases=cases, mode=ShipMode.FTL, ship_date=date(2025, 10, 13),
                    eta=date(2025, 10, 14), rsl_on_arrival_days=600, freight_alloc_inr=0.0)


def test_build_loads_splits_whole_cases_and_allocates_freight():
    sc, _, _ = _fx()
    # 800 cases of detergent (12.5 kg) = 10 t -> 2 trucks of 7 t; whole cases only
    lines = [_line(1, "HC-02", "BHW-HC02-0101", "W1-Bhiwandi", "D01-Pune", 800)]
    out, trucks = freight.build_loads(lines, {("W1-Bhiwandi", "D01-Pune", TruckClass.AMB32): 2}, sc)
    assert len(trucks) == 2 and sum(l.cases for l in out) == 800
    assert all(t.kg <= 7000 for t in trucks)
    assert [l.line_id for l in out] == ["PL-T-v1-001", "PL-T-v1-002"]
    for t in trucks:
        assert t.cost_inr == pytest.approx(freight.ftl_trip_cost(_lane(sc, "W1-Bhiwandi", "D01-Pune"), TruckClass.AMB32,
                                                                 date(2025, 10, 13)))
        assert sum(l.freight_alloc_inr for l in out if l.truck_id == t.truck_id) == pytest.approx(t.cost_inr, abs=0.05)


def test_build_loads_adds_a_truck_when_given_too_few_and_drops_unused():
    sc, _, _ = _fx()
    lines = [_line(1, "HC-02", "BHW-HC02-0101", "W1-Bhiwandi", "D01-Pune", 800)]
    _, trucks = freight.build_loads(lines, {("W1-Bhiwandi", "D01-Pune", TruckClass.AMB32): 1}, sc)
    assert len(trucks) == 2
    _, trucks = freight.build_loads(lines, {("W1-Bhiwandi", "D01-Pune", TruckClass.AMB32): 5}, sc)
    assert len(trucks) == 2


def test_build_loads_ptl_and_chilled():
    sc, _, _ = _fx()
    amb = [_line(1, "SN-01", "HSR-SN01-0388", "S1-Hosur", "D09-Bengaluru", 50)]
    out, trucks = freight.build_loads(amb, {}, sc)                                    # no trips -> PTL
    assert trucks[0].mode is ShipMode.PTL and out[0].consignment_id == trucks[0].truck_id and out[0].truck_id is None
    dairy = [_line(1, "DY-03", "HSR-DY03-1187", "S1-Hosur", "D09-Bengaluru", 20)]
    out, trucks = freight.build_loads(dairy, {}, sc)                                  # chilled always reefer FTL
    assert trucks[0].mode is ShipMode.FTL and trucks[0].truck_class is TruckClass.REEF17


# --------------------------------------------------------------------------- validator

def _kinds(rep) -> set[str]:
    return {v.constraint.value for v in rep.violations}


def test_fixture_plan_is_valid():
    sc, snap, plan = _fx()
    rep = validate_plan(plan, sc, snap)
    assert rep.ok, rep.violations


@pytest.mark.parametrize("policy", [BaselineA(), BaselineB(seed=2)])
@pytest.mark.parametrize("tc", [TempClass.AMBIENT, TempClass.CHILLED])
def test_baseline_plans_are_valid(policy, tc):
    sc, snap, _ = _fx()
    plan = policy.plan(sc, snap, load_fixture("forecast", ForecastBundle), tc)
    rep = validate_plan(plan, sc, snap, require_reasons=False)
    assert rep.ok, rep.violations


def test_catches_lot_overshipment():
    sc, snap, plan = _fx()
    plan.lines[2].cases = 10_000
    assert "lot_stock" in _kinds(validate_plan(plan, sc, snap))


def test_catches_wrong_depot_for_lot():
    sc, snap, plan = _fx()
    plan.lines[0].from_id = "S1-Hosur"
    assert "lot_stock" in _kinds(validate_plan(plan, sc, snap))


def test_catches_mrsl():
    sc, snap, plan = _fx()
    short = [l.model_copy(update={"expiry_date": date(2025, 11, 1)}) if l.lot_id == "BHW-SN01-0420" else l
             for l in snap.depot_lots]
    assert "mrsl" in _kinds(validate_plan(plan, sc, snap.model_copy(update={"depot_lots": short})))


def test_catches_storage_and_credit():
    sc, snap, plan = _fx()
    tight = snap.model_copy(update={"storage_free_m3": {**snap.storage_free_m3, "D01-Pune": 1.0},
                                    "credit_available_inr": {**snap.credit_available_inr, "D01-Pune": 1000.0}})
    assert {"storage", "credit"} <= _kinds(validate_plan(plan, sc, tight))


def test_catches_overloaded_truck():
    sc, snap, plan = _fx()
    big = snap.model_copy(update={"depot_lots": [l.model_copy(update={"qty_cases": 99_999}) for l in snap.depot_lots],
                                  "storage_free_m3": {k: 1e9 for k in snap.storage_free_m3},
                                  "credit_available_inr": {k: 1e12 for k in snap.credit_available_inr}})
    plan.lines[1].cases = 2000                                   # 25 t of detergent on one 7 t truck
    assert "truck_kg" in _kinds(validate_plan(plan, sc, big))


def test_catches_locks():
    sc, snap, plan = _fx()
    line = plan.lines[0]
    locks = [Lock(lot_id=line.lot_id, dist_id=line.to_id, kind="fix", qty=line.cases + 5),
             Lock(lot_id=line.lot_id, dist_id=line.to_id, kind="cap", qty=line.cases - 1),
             Lock(lot_id=line.lot_id, dist_id=line.to_id, kind="min", qty=line.cases)]
    rep = validate_plan(plan, sc, snap, locks)
    assert sum(v.constraint.value == "lock" for v in rep.violations) == 2


def test_catches_missing_truck_and_reason():
    sc, snap, plan = _fx()
    plan.lines[0].truck_id = None
    plan.lines[3].reasons = []
    assert {"missing_truck", "missing_reason"} <= _kinds(validate_plan(plan, sc, snap))
    assert "missing_reason" not in _kinds(validate_plan(plan, sc, snap, require_reasons=False))


def test_rejected_lines_are_ignored():
    sc, snap, plan = _fx()
    plan.lines[2].cases = 10_000
    plan.lines[2].status = LineStatus.REJECTED
    assert validate_plan(plan, sc, snap).ok


def test_validator_does_not_import_the_optimiser():
    import ast

    import dia_engine.optimize.validate as v
    tree = ast.parse(open(v.__file__, encoding="utf-8").read())
    imported = {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
    imported |= {a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
    assert not any(m and m.startswith("dia_engine.optimize") for m in imported), imported
