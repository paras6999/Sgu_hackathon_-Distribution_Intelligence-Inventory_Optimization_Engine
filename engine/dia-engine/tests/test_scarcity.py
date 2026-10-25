"""FR-05 scarcity check: one extra case should not recover more margin than it costs to ship it.

This is a seed01 approximation of the PRD's hand-built 2-depot, 4-distributor scarcity case. It is not that case.

Setup: seed01 imbalanced ambient on 2025-09-29. For each SKU, every depot lot is scaled by one factor so the
SKU's total depot stock equals 60% of its total target mean demand (sum of Target.mu over distributors).
The allocation MILP is then solved on that snapshot.

Criterion, for each (sku, dist) target with mu > 0 and zero cases shipped by the plan:
* Feasible only. The solver may use only lots on candidate depots (home depot plus the nearest others, as
  optimize.py builds them) whose life on arrival passes the MRSL floor. Rows with no such lot are not checked.
* Credit and storage not binding. A distributor whose credit or godown is (nearly) full cannot take one more
  case whatever the freight, so its rows are excluded. The first version of this test did not exclude them
  and counted 51 false violations in one run; every one of those was a credit-bound distributor.
* net gain of one extra case = pi x P(D > z) - (holding + expiry) x P(D <= z), with D the window demand (mu,
  sigma^2), z the post-plan stock position (on hand + in transit + shipped), pi = stockout_penalty_x_margin x
  margin_inr x pi_mult, holding = holding_rate x landed x review / 365, expiry = (landed + disposal) x claim share x
  omega_mult. The leftover terms matter: the first version ignored them and over-counted the gain. Window
  expiry uses the cover window, not the true remaining life, so this is an approximation of the objective.
* cost = the freight one more case adds on the cheapest feasible lane, given the plan: zero if a booked truck on
  that lane has room for the case; the part-load rate if the lane already has a part-load charge; otherwise the
  cheaper of the part-load charge (minimum charge applies) and a new truck. Lanes are priced as the solver prices
  them, so a lane's first case is not treated as free.
* Violation when net gain > cost, i.e. the optimiser left a case unshipped although even the cheapest freight
  leaves a positive net gain. That is a suboptimal incumbent or a modelling gap, not a reason code issue.

The test asserts at least one checked row (so it cannot pass vacuously) and zero violations.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date

import pytest

from dia_engine.config import get_config
from dia_engine.data.generate import load_scenario
from dia_engine.forecast.dist import expected_shortfall
from dia_engine.forecast.forecast import forecast
from dia_engine.forecast.targets import compute_targets
from dia_engine.optimize import freight, optimize
from dia_engine.sim.simulate import get_snapshot
from dia_types import OpeningState, OptimizeInput, ShipMode, TempClass

T0 = date(2025, 9, 29)
STOCK_SHARE = 0.6
BOUND_SHARE = 0.97     # credit or storage above this share of the limit counts as binding
LOOSE_LIMIT_FACTOR = 100.0   # credit and godown limits are scaled up so only stock and freight bind
TEST_MIP_BUDGET_S = 8.0


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


def _candidate_depots(sc, dist_id: str, home_only: bool = False) -> set[str]:
    """Same rule as optimize.solve: home depot plus the nearest others within the alt-depot distance."""
    lanes = {(l.from_id, l.to_id): l for l in sc.lanes}
    node = next(n for n in sc.nodes if n.node_id == dist_id)
    km = get_config().network.alt_depot_max_km
    others = sorted((l for l in sc.lanes if l.to_id == dist_id and l.from_id != node.home_depot_id and l.km <= km),
                    key=lambda l: (l.km, l.from_id))
    return {node.home_depot_id, *(l.from_id for l in others[:optimize.CANDIDATE_DEPOTS - 1])} if not home_only else {node.home_depot_id}


@pytest.mark.xfail(strict=True, reason=(
    "Known gap: the greedy refill of truck room freed by rounding (PRD 6.5 step 6) is not implemented "
    "(optimize.py header). Rounded plans leave room on booked trucks that the solver does not fill; 8 of 13 "
    "checked rows violate. Expected failure until the refill is built."))
def test_one_extra_case_never_recovers_more_margin_than_it_costs(world, monkeypatch):
    monkeypatch.setattr(optimize, "MIP_BUDGET_S", TEST_MIP_BUDGET_S)   # see test_counterfactual.py
    sc, snap, fc = world
    cfg = get_config()
    review = cfg.planning.cadence_days["ambient"]
    targets = compute_targets(sc, fc, TempClass.AMBIENT)
    skus = {s.sku_id: s for s in sc.skus}
    lanes = {(l.from_id, l.to_id): l for l in sc.lanes}
    nodes = {n.node_id: n for n in sc.nodes}
    truck = freight.truck_class_for(TempClass.AMBIENT)
    cap = freight.capacity(truck)
    mrsl_default = cfg.planning.mrsl_fraction["GT"]

    demand: dict[str, float] = defaultdict(float)
    for t in targets:
        demand[t.sku_id] += t.mu
    stock: dict[str, float] = defaultdict(float)
    for l in snap.depot_lots:
        if l.sku_id in demand:
            stock[l.sku_id] += l.qty_cases
    factor = {p: STOCK_SHARE * demand[p] / stock[p] for p in demand}
    scarce = snap.model_copy(update={"depot_lots": [
        l.model_copy(update={"qty_cases": l.qty_cases * factor[l.sku_id]}) if l.sku_id in factor else l
        for l in snap.depot_lots]})

    # Credit and storage are the binding limits for almost every row at 60% stock (see the docstring), so relax
    # them here: the question is whether freight and stock alone justify leaving a case unshipped.
    scarce = scarce.model_copy(update={
        "credit_available_inr": {k: v * LOOSE_LIMIT_FACTOR for k, v in scarce.credit_available_inr.items()},
        "storage_free_m3": {k: v * LOOSE_LIMIT_FACTOR for k, v in scarce.storage_free_m3.items()}})
    inp = OptimizeInput(scenario=sc, snapshot=scarce, forecast=fc, targets=targets, temp_class=TempClass.AMBIENT,
                        plan_id="PL-SCARCE", version=1)
    plan = optimize.solve(inp).plan

    shipped: dict[tuple[str, str], float] = defaultdict(float)
    lot_shipped: dict[str, float] = defaultdict(float)
    value: dict[str, float] = defaultdict(float)
    m3_used: dict[str, float] = defaultdict(float)
    for line in plan.lines:
        s = skus[line.sku_id]
        shipped[(line.sku_id, line.to_id)] += line.cases
        lot_shipped[line.lot_id] += line.cases
        value[line.to_id] += line.cases * s.price_inr
        m3_used[line.to_id] += line.cases * s.m3_per_case
    on_hand: dict[tuple[str, str], float] = defaultdict(float)
    for d in scarce.dist_stock:
        on_hand[(d.sku_id, d.dist_id)] += d.qty_cases
    in_transit: dict[tuple[str, str], float] = defaultdict(float)
    for t in scarce.in_transit:
        in_transit[(t.sku_id, t.to_id)] += t.qty_cases

    rows, skipped = [], defaultdict(int)
    for t in targets:
        key = (t.sku_id, t.dist_id)
        if t.mu <= 0 or shipped[key] > 0:
            continue
        sku = skus[t.sku_id]
        j = t.dist_id
        mrsl = nodes[j].mrsl_fraction or mrsl_default
        feasible = []
        for l in scarce.depot_lots:
            # a lot counts only while stock is left after the plan's own shipments from it
            if l.sku_id != t.sku_id or l.qty_cases - lot_shipped[l.lot_id] < 1 or l.depot_id not in _candidate_depots(sc, j):
                continue
            lane = lanes[(l.depot_id, j)]
            rsl = (l.expiry_date - snap.as_of).days - math.ceil(lane.lead_days_mean)
            if rsl >= mrsl * sku.shelf_life_days:
                feasible.append(lane)
        if not feasible:
            skipped["no feasible lot"] += 1
            continue
        if value[j] + sku.price_inr > BOUND_SHARE * scarce.credit_available_inr.get(j, math.inf):
            skipped["credit binding"] += 1
            continue
        if m3_used[j] + sku.m3_per_case > BOUND_SHARE * scarce.storage_free_m3.get(j, math.inf):
            skipped["storage binding"] += 1
            continue
        z = on_hand[key] + in_transit[key] + shipped[key]
        pi = cfg.costs.stockout_penalty_x_margin * sku.margin_inr * inp.settings.weights.pi_mult
        p_sell = expected_shortfall(t.mu, t.sigma ** 2, z) - expected_shortfall(t.mu, t.sigma ** 2, z + 1)  # P(D > z)
        recovered = pi * p_sell
        holding = cfg.costs.holding_rate_annual * sku.landed_cost_inr * review / 365
        expiry = (sku.landed_cost_inr + sku.disposal_inr) * cfg.costs.expiry_claim_share * inp.settings.weights.omega_mult
        leftover_cost = (holding + expiry) * (1 - p_sell)                                  # P(D <= z): case left over
        net = recovered - leftover_cost
        def marginal(lane) -> float:
            """Freight added by one more case on this lane, given what the plan already pays for."""
            chargeable = max(sku.kg_per_case, cfg.costs.ptl.kg_per_m3 * sku.m3_per_case)
            on_lane = [x for x in plan.trucks if x.from_id == lane.from_id and x.to_id == lane.to_id]
            if any(x.mode is ShipMode.FTL and cap.kg - x.kg >= sku.kg_per_case and cap.m3 - x.m3 >= sku.m3_per_case
                   for x in on_lane):
                return 0.0                                  # room on a truck already paid for
            if any(x.mode is ShipMode.PTL for x in on_lane):
                return lane.ptl_rate_inr_per_kg * chargeable  # lane already has a part-load charge
            # first case on the lane: the PTL minimum charge applies, or a whole new truck
            return min(max(lane.ptl_min_charge_inr, lane.ptl_rate_inr_per_kg * chargeable),
                       freight.ftl_trip_cost(lane, truck, snap.as_of))
        per_case = min(marginal(lane) for lane in feasible)
        rows.append((t.sku_id, j, z, t.mu, net, per_case, net > per_case))

    violations = [r for r in rows if r[6]]
    print(f"\nskipped {dict(skipped)}")
    print(f"checked {len(rows)} unshipped feasible targets with free credit and storage; violations {len(violations)}")
    print(f"{'sku':<12}{'dist':<16}{'z':>10}{'mu':>10}{'recovered':>14}{'cost/case':>14}  violation")
    for sku_id, dist_id, z, mu, rec, cost, bad in rows:
        print(f"{sku_id:<12}{dist_id:<16}{z:>10.2f}{mu:>10.2f}{rec:>14.2f}{cost:>14.2f}  {bad}")
    assert rows, "no unshipped feasible targets with free credit and storage; the scarcity case did not bind"
    assert not violations, f"{len(violations)} (sku, dist) rows recover more margin than one case costs"
