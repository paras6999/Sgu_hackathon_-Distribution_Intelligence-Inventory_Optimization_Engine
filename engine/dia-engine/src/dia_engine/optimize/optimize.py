"""FR-05 Allocation MILP, PRD 6.6.3. PuLP + HiGHS, CBC fallback.

One model per temperature class. Shipment quantities x_bj are continuous, FTL trips and the PTL switch are
integer; quantities are rounded down to whole cases afterwards and loads are built by optimize.freight.
The expected lost-sales (C2) and expected-waste (C8) curves are convex piecewise-linear, so they need no
binaries. Not done: the greedy refill of truck capacity freed by rounding (PRD 6.5 step 6).
"""
from __future__ import annotations

import math
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import pulp

from dia_engine.config import get_config
from dia_engine.forecast.dist import expected_leftover, expected_shortfall, quantile, window
from dia_engine.optimize import freight
from dia_types import (
    ExpectedKpis, LineStatus, LockKind, OptimizeInput, Plan, PlanLine, PolicyName, ShipMode, SolveInfo, SolveOutput,
    SolveStatus, TempClass,
)

CANDIDATE_DEPOTS = 3            # home depot plus the 2 nearest others (PRD 6.5 step 4)
MIP_BUDGET_S = 1.5              # HiGHS finds its incumbent in well under a second here; the rest is proving the gap
WASTE_MATERIAL_CASES = 0.5      # build a C8 curve only when expected waste at the full lot exceeds this


class SolverFailed(RuntimeError):
    """Raised when no usable solution exists; pipeline falls back to Baseline B."""


def _lost_sales_segments(mu: float, var: float, points: list[float]) -> list[tuple[float, float]]:
    """(A, G) with ls >= A - G*z for each segment of the interpolant of E[(D - z)+] (C2)."""
    zs = sorted({max(quantile(mu, var, q), 0.0) for q in points})
    ls = [expected_shortfall(mu, var, z) for z in zs]
    return [(ls[i] - (ls[i + 1] - ls[i]) / (zs[i + 1] - zs[i]) * zs[i], (ls[i] - ls[i + 1]) / (zs[i + 1] - zs[i]))
            for i in range(len(zs) - 1)]


def _waste_segments(mu: float, var: float, points: list[float]) -> list[tuple[float, float]]:
    """(a, k) with phi >= a*x - k for each segment of the interpolant of E[(q - D)+] (C8)."""
    qs = sorted({max(quantile(mu, var, p), 0.0) for p in points})
    w = [expected_leftover(mu, var, q) for q in qs]
    out = []
    for i in range(len(qs) - 1):
        a = (w[i + 1] - w[i]) / (qs[i + 1] - qs[i])
        out.append((a, a * qs[i] - w[i]))
    return out


def _solver(time_limit: float, gap: float):
    try:
        return pulp.getSolver("HiGHS", msg=False, timeLimit=time_limit, gapRel=gap, threads=1)
    except Exception:  # noqa: BLE001 - highspy missing or incompatible
        return pulp.PULP_CBC_CMD(msg=False, timeLimit=time_limit, gapRel=gap, threads=1)


def solve(inp: OptimizeInput) -> SolveOutput:
    """Return a Plan with lines and trucks (reasons empty) plus diagnostics for explain.py.

    Honour inp.settings ablation switches (no_expiry_term, no_truck_steps, no_credit,
    home_depot_only) and inp.locks (constraint C10).
    """
    t_start = time.perf_counter()
    cfg = get_config()
    st = inp.settings
    snap, sc = inp.snapshot, inp.scenario
    tc = freight.truck_class_for(inp.temp_class)
    cap = freight.capacity(tc)
    ambient = inp.temp_class is TempClass.AMBIENT
    review = cfg.planning.cadence_days[inp.temp_class.value]
    mrsl_default = cfg.planning.mrsl_fraction["GT"]

    skus = {s.sku_id: s for s in sc.skus if s.temp_class == inp.temp_class}
    nodes = {n.node_id: n for n in sc.nodes}
    lanes = {(l.from_id, l.to_id): l for l in sc.lanes}
    targets = {(t.sku_id, t.dist_id): t for t in inp.targets if t.sku_id in skus}
    pairs = {(p.sku_id, p.dist_id): p for p in inp.forecast.pairs if p.sku_id in skus}
    lots = [l for l in snap.depot_lots if l.sku_id in skus and l.qty_cases >= 1]
    lots_by = {l.lot_id: l for l in lots}
    dists = sorted({j for (_, j) in targets})

    by_km: dict[str, list[str]] = defaultdict(list)
    for l in sorted(sc.lanes, key=lambda l: (l.km, l.from_id)):
        by_km[l.to_id].append(l.from_id)
    cand: dict[str, set[str]] = {}
    for j in dists:
        home = nodes[j].home_depot_id
        others = [w for w in by_km[j] if w != home]
        cand[j] = {home} if st.home_depot_only else {home, *others[:CANDIDATE_DEPOTS - 1]}

    # arcs: candidate depot, usable stock, RSL on arrival >= MRSL (C-filter of PRD 6.5 step 4)
    arcs: list[tuple[str, str]] = []
    for l in lots:
        sku = skus[l.sku_id]
        for j in dists:
            if l.depot_id not in cand[j] or (l.sku_id, j) not in targets:
                continue
            lead = math.ceil(lanes[(l.depot_id, j)].lead_days_mean)
            rsl = (l.expiry_date - snap.as_of).days - lead
            if rsl >= (nodes[j].mrsl_fraction or mrsl_default) * sku.shelf_life_days:
                arcs.append((l.lot_id, j))

    m = pulp.LpProblem("allocate", pulp.LpMinimize)
    x = {a: pulp.LpVariable(f"x_{n}", 0, lots_by[a[0]].qty_cases) for n, a in enumerate(arcs)}
    obj = []

    # ---- C1 lot stock, C6 storage, C7 credit
    by_lot: dict[str, list] = defaultdict(list)
    by_dist: dict[str, list] = defaultdict(list)
    by_pair: dict[tuple[str, str], list] = defaultdict(list)
    by_lane: dict[tuple[str, str], list] = defaultdict(list)
    for (b, j), v in x.items():
        l = lots_by[b]
        by_lot[b].append(v)
        by_dist[j].append((v, skus[l.sku_id]))
        by_pair[(l.sku_id, j)].append(v)
        by_lane[(l.depot_id, j)].append((v, skus[l.sku_id]))
    for b, vs in by_lot.items():
        m += pulp.lpSum(vs) <= lots_by[b].qty_cases
    for j, vs in by_dist.items():
        m += pulp.lpSum(v * s.m3_per_case for v, s in vs) <= snap.storage_free_m3.get(j, math.inf)
        if not st.no_credit:
            m += pulp.lpSum(v * s.price_inr for v, s in vs) <= snap.credit_available_inr.get(j, math.inf)

    # ---- position I_jp and C2 expected lost sales
    pos: dict[tuple[str, str], float] = defaultdict(float)
    for d in snap.dist_stock:
        pos[(d.sku_id, d.dist_id)] += d.qty_cases
    for t in snap.in_transit:
        pos[(t.sku_id, t.to_id)] += t.qty_cases
    ls_var: dict[tuple[str, str], pulp.LpVariable] = {}
    z_expr: dict[tuple[str, str], pulp.LpAffineExpression] = {}
    for n, key in enumerate(sorted(targets)):
        p, j = key
        tg, sku = targets[key], skus[p]
        z = pos[key] + pulp.lpSum(by_pair.get(key, []))
        z_expr[key] = z
        var = tg.sigma ** 2
        ls = pulp.LpVariable(f"ls_{n}", 0)
        ls_var[key] = ls
        for A, G in _lost_sales_segments(tg.mu, var, cfg.planning.lost_sales_breakpoints):
            m += ls >= A - G * z
        pi = cfg.costs.stockout_penalty_x_margin * sku.margin_inr * st.weights.pi_mult
        h = cfg.costs.holding_rate_annual * sku.landed_cost_inr * review / 365
        obj.append(pi * ls)
        obj.append(h * (z - tg.mu + ls))

    # ---- C8 expected waste in market, MRSL cliff at the depot
    phi_vars: list[tuple[tuple[str, str], pulp.LpVariable]] = []
    if not st.no_expiry_term:
        claim = cfg.costs.expiry_claim_share
        for n, (b, j) in enumerate(arcs):
            l = lots_by[b]
            sku = skus[l.sku_id]
            lead = math.ceil(lanes[(l.depot_id, j)].lead_days_mean)
            tau = (l.expiry_date - snap.as_of).days - lead
            pf = pairs.get((l.sku_id, j))
            if pf is None or tau < 1:
                continue
            mu_t, var_t = window(pf, pf.start, tau)
            if expected_leftover(mu_t, var_t, l.qty_cases) <= WASTE_MATERIAL_CASES:
                continue
            phi = pulp.LpVariable(f"phi_{n}", 0)
            phi_vars.append(((b, j), phi))
            for a, k in _waste_segments(mu_t, var_t, cfg.planning.waste_breakpoints):
                m += phi >= a * x[(b, j)] - k
            m += phi >= x[(b, j)] - mu_t
            obj.append((sku.landed_cost_inr + sku.disposal_inr) * claim * st.weights.omega_mult * phi)
        for b, l in lots_by.items():
            sku = skus[l.sku_id]
            if (l.expiry_date - snap.as_of).days - review < mrsl_default * sku.shelf_life_days:
                # falls below MRSL before the next cycle: whatever stays at the depot is written off
                obj.append(-(sku.landed_cost_inr + sku.disposal_inr) * st.weights.omega_mult * pulp.lpSum(by_lot.get(b, [])))

    # ---- freight: C3/C4 trucks, C5 PTL pricing
    y: dict[tuple[str, str], pulp.LpVariable] = {}
    q: dict[tuple[str, str], pulp.LpVariable] = {}
    s_: dict[tuple[str, str], pulp.LpVariable] = {}
    d_: dict[tuple[str, str], pulp.LpVariable] = {}
    carbon_kg = 0
    kg_per_m3 = cfg.costs.ptl.kg_per_m3
    integer = pulp.LpContinuous if st.no_truck_steps else pulp.LpInteger
    for n, (key, vs) in enumerate(sorted(by_lane.items())):
        lane = lanes[key]
        kg = pulp.lpSum(v * s.kg_per_case for v, s in vs)
        m3 = pulp.lpSum(v * s.m3_per_case for v, s in vs)
        max_trips = freight.trips_needed(sum(v.upBound * s.kg_per_case for v, s in vs),
                                         sum(v.upBound * s.m3_per_case for v, s in vs), tc)
        y[key] = pulp.LpVariable(f"y_{n}", 0, max_trips, integer)
        trip = freight.ftl_trip_cost(lane, tc, snap.as_of)
        obj.append(trip * y[key])
        carbon_kg += lane.co2_kg_per_trip[tc.value] * y[key]
        if ambient:
            q[key], s_[key] = pulp.LpVariable(f"q_{n}", 0), pulp.LpVariable(f"s_{n}", 0)
            d_[key] = pulp.LpVariable(f"d_{n}", 0, 1, pulp.LpContinuous if st.no_truck_steps else pulp.LpBinary)
            c, f = pulp.LpVariable(f"c_{n}", 0), pulp.LpVariable(f"f_{n}", 0)
            m += kg <= cap.kg * y[key] + q[key]
            m += m3 <= cap.m3 * y[key] + s_[key]
            m += c >= q[key]
            m += c >= kg_per_m3 * s_[key]
            m += f >= lane.ptl_rate_inr_per_kg * c
            if not st.no_truck_steps:
                m += f >= lane.ptl_min_charge_inr * d_[key]
            m += q[key] <= cap.kg * d_[key]
            m += s_[key] <= cap.m3 * d_[key]
            obj.append(f)
            carbon_kg += lane.co2_kg_per_trip[tc.value] / (cap.kg * cfg.carbon.ptl_load_factor) * q[key]
        else:
            m += kg <= cap.kg * y[key]
            m += m3 <= cap.m3 * y[key]
    if st.weights.carbon_inr_per_kg:
        obj.append(st.weights.carbon_inr_per_kg * carbon_kg)

    # ---- C10 locks
    for lock in inp.locks:
        if lock.lot_id not in lots_by:
            continue
        v = x.get((lock.lot_id, lock.dist_id))
        if v is None:
            if lock.kind is not LockKind.CAP and lock.qty > 0:
                raise SolverFailed(f"lock on {lock.lot_id}->{lock.dist_id} has no feasible arc")
            continue
        if lock.kind is LockKind.FIX:
            m += v == lock.qty
        elif lock.kind is LockKind.CAP:
            m += v <= lock.qty
        else:
            m += v >= lock.qty

    m += pulp.lpSum(obj)
    build_s = time.perf_counter() - t_start
    try:
        m.solve(_solver(min(st.time_limit_s, MIP_BUDGET_S), st.mip_gap))
    except Exception as e:  # noqa: BLE001
        raise SolverFailed(str(e)) from e
    seconds = time.perf_counter() - t_start
    if pulp.LpStatus[m.status] not in ("Optimal", "Not Solved") or any(v.value() is None for v in x.values()):
        raise SolverFailed(f"solver status {pulp.LpStatus[m.status]}")
    timed_out = seconds - build_s >= min(st.time_limit_s, MIP_BUDGET_S) * 0.95
    if pulp.LpStatus[m.status] == "Not Solved" and not timed_out:
        raise SolverFailed("solver returned no solution")

    # ---- round down to whole cases, keep locks exact, build loads
    eta_of = lambda w, j: snap.as_of + timedelta(days=math.ceil(lanes[(w, j)].lead_days_mean))  # noqa: E731
    prefix = f"{inp.plan_id}-v{inp.version}"
    lines: list[PlanLine] = []
    for (b, j), v in sorted(x.items()):
        cases = int(math.floor(v.value() + 1e-6))
        if cases <= 0:
            continue
        l, sku = lots_by[b], skus[lots_by[b].sku_id]
        eta = eta_of(l.depot_id, j)
        lines.append(PlanLine(
            line_id=f"{prefix}-{len(lines) + 1:03d}", sku_id=sku.sku_id, sku_name=sku.name, lot_id=b,
            expiry=l.expiry_date, from_id=l.depot_id, to_id=j, cases=cases, mode=ShipMode.FTL, ship_date=snap.as_of,
            eta=eta, rsl_on_arrival_days=(l.expiry_date - eta).days, freight_alloc_inr=0.0,
            reasons=[], proposal_version=inp.version, status=LineStatus.PROPOSED))

    trips: dict[tuple[str, str, object], int] = {}
    kg_l: dict[tuple[str, str], float] = defaultdict(float)
    m3_l: dict[tuple[str, str], float] = defaultdict(float)
    for l in lines:
        kg_l[(l.from_id, l.to_id)] += l.cases * skus[l.sku_id].kg_per_case
        m3_l[(l.from_id, l.to_id)] += l.cases * skus[l.sku_id].m3_per_case
    for key in kg_l:
        use_ptl = ambient and not st.no_truck_steps and d_[key].value() > 0.5 and y[key].value() < 0.5
        trips[(*key, tc)] = 0 if use_ptl else freight.trips_needed(kg_l[key], m3_l[key], tc)
    lines, trucks = freight.build_loads(lines, trips, sc)

    # ---- expected KPIs from the final integer plan
    shipped: dict[tuple[str, str], float] = defaultdict(float)
    for l in lines:
        shipped[(l.sku_id, l.to_id)] += l.cases
    lost = holding = 0.0
    for key, tg in targets.items():
        sku = skus[key[0]]
        z = pos[key] + shipped.get(key, 0.0)
        sf = expected_shortfall(tg.mu, tg.sigma ** 2, z)
        lost += cfg.costs.stockout_penalty_x_margin * sku.margin_inr * st.weights.pi_mult * sf
        holding += cfg.costs.holding_rate_annual * sku.landed_cost_inr * review / 365 * (z - tg.mu + sf)
    expiry = 0.0
    for l in lines:
        sku, pf = skus[l.sku_id], pairs.get((l.sku_id, l.to_id))
        if pf is None or st.no_expiry_term or l.rsl_on_arrival_days < 1:
            continue
        mu_t, var_t = window(pf, pf.start, l.rsl_on_arrival_days)
        expiry += (sku.landed_cost_inr + sku.disposal_inr) * cfg.costs.expiry_claim_share * st.weights.omega_mult \
            * expected_leftover(mu_t, var_t, l.cases)
    freight_inr = sum(t.cost_inr for t in trucks)
    co2 = sum(lanes[(t.from_id, t.to_id)].co2_kg_per_trip[tc.value] for t in trucks if t.mode is ShipMode.FTL)
    kpis = ExpectedKpis(freight_inr=freight_inr, lost_margin_inr=lost, holding_inr=holding, expiry_inr=expiry,
                        carbon_kg=co2, total_inr=freight_inr + lost + holding + expiry,
                        cases=float(sum(l.cases for l in lines)))
    plan = Plan(plan_id=inp.plan_id, version=inp.version, scenario_id=sc.scenario_id, as_of=snap.as_of,
                temp_class=inp.temp_class, policy=PolicyName.ENGINE, settings=st, lines=lines, trucks=trucks,
                expected_kpis=kpis,
                solve=SolveInfo(status=SolveStatus.TIME_LIMIT if timed_out else SolveStatus.OPTIMAL,
                                seconds=round(seconds, 4), solver="highs"),
                created_at=datetime.now(timezone.utc))
    diagnostics = {
        "z": {f"{j}|{p}": pos[(p, j)] + shipped.get((p, j), 0.0) for (p, j) in targets},
        "expected_lost_cases": {f"{j}|{p}": expected_shortfall(t.mu, t.sigma ** 2, pos[(p, j)] + shipped.get((p, j), 0.0))
                                for (p, j), t in targets.items()},
        "arcs": len(arcs), "waste_curves": len(phi_vars), "lanes": len(by_lane),
    }
    return SolveOutput(plan=plan, diagnostics=diagnostics)
