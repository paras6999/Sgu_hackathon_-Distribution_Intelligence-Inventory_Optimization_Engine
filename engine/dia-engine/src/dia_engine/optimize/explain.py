"""FR-06 Reason codes, PRD 6.6.4. Rules are evaluated on the finished plan; nothing here changes a quantity."""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date

from dia_engine.config import get_config
from dia_engine.forecast.dist import expected_leftover, window
from dia_engine.optimize import freight
from dia_types import OptimizeInput, Plan, PlanLine, Reason, ReasonCode, Shortfall, ShipMode, SolveOutput

MAX_REASONS = 2          # per line, ordered by INR impact
MIN_SHORT_CASES = 1.0    # smaller gaps to target are rounding, not a shortfall
FESTIVAL_MIN = 1.15
WEATHER_HI, WEATHER_LO = 1.10, 0.90
MIN_WASTE_GAIN_CASES = 1.0
R = ReasonCode


def _inr(v: float) -> str:
    return f"₹{v:,.0f}"


def add_reasons(out: SolveOutput, inp: OptimizeInput) -> Plan:
    """Fill 1-2 reasons per line (ordered by INR impact) and the shortfall rows. Every line gets >= 1 code."""
    cfg = get_config()
    plan, snap, sc = out.plan, inp.snapshot, inp.scenario
    skus = {s.sku_id: s for s in sc.skus}
    nodes = {n.node_id: n for n in sc.nodes}
    lanes = {(l.from_id, l.to_id): l for l in sc.lanes}
    targets = {(t.sku_id, t.dist_id): t for t in inp.targets}
    pairs = {(p.sku_id, p.dist_id): p for p in inp.forecast.pairs}
    weekly = defaultdict(list)
    for row in inp.forecast.weekly:
        weekly[(row.sku_id, row.dist_id)].append(row)
    lots = {l.lot_id: l for l in snap.depot_lots}
    review = cfg.planning.cadence_days[inp.temp_class.value]
    mrsl = cfg.planning.mrsl_fraction["GT"]
    claim = cfg.costs.expiry_claim_share
    tc = freight.truck_class_for(inp.temp_class)
    cap = freight.capacity(tc)
    trucks = {t.truck_id: t for t in plan.trucks}

    pos: dict[tuple[str, str], float] = defaultdict(float)
    for d in snap.dist_stock:
        pos[(d.sku_id, d.dist_id)] += d.qty_cases
    for t in snap.in_transit:
        pos[(t.sku_id, t.to_id)] += t.qty_cases
    shipped: dict[tuple[str, str], float] = defaultdict(float)
    used: dict[str, float] = defaultdict(float)
    m3_to: dict[str, float] = defaultdict(float)
    value_to: dict[str, float] = defaultdict(float)
    for l in plan.lines:
        shipped[(l.sku_id, l.to_id)] += l.cases
        used[l.lot_id] += l.cases
        m3_to[l.to_id] += l.cases * skus[l.sku_id].m3_per_case
        value_to[l.to_id] += l.cases * skus[l.sku_id].price_inr

    def z_of(key) -> float:
        return pos[key] + shipped.get(key, 0.0)

    def rsl_ok(lot, depot_to: str) -> bool:
        lane = lanes.get((lot.depot_id, depot_to))
        if lane is None:
            return False
        rsl = (lot.expiry_date - snap.as_of).days - math.ceil(lane.lead_days_mean)
        return rsl >= (nodes[depot_to].mrsl_fraction or mrsl) * skus[lot.sku_id].shelf_life_days

    def per_case_cost(depot: str, j: str, sku_id: str) -> float:
        """Lower of PTL and full-truck cost per case on a lane (PRD 6.6.4, CHEAPEST_SOURCE)."""
        sku, lane = skus[sku_id], lanes[(depot, j)]
        full = freight.ftl_trip_cost(lane, tc, snap.as_of) * max(sku.kg_per_case / cap.kg, sku.m3_per_case / cap.m3)
        if inp.temp_class.value == "ambient":
            return min(full, freight.ptl_cost(lane, sku.kg_per_case, sku.m3_per_case, snap.as_of))
        return full

    def waste(pf, lot, to: str, cases: float) -> float:
        lane = lanes[(lot.depot_id, to)]
        tau = (lot.expiry_date - snap.as_of).days - math.ceil(lane.lead_days_mean)
        if pf is None or tau < 1:
            return 0.0
        mu, var = window(pf, pf.start, tau)
        return expected_leftover(mu, var, cases)

    blocked_cache: dict[tuple[str, str, str], bool] = {}

    def depot_blocked(depot: str, sku_id: str, j: str) -> bool:
        """Depot holds stock of the SKU but every lot fails MRSL for j."""
        key = (depot, sku_id, j)
        if key not in blocked_cache:
            held = [l for l in snap.depot_lots if l.depot_id == depot and l.sku_id == sku_id and l.qty_cases >= 1]
            blocked_cache[key] = bool(held) and not any(rsl_ok(l, j) for l in held)
        return blocked_cache[key]

    def limit_reasons(key: tuple[str, str], cases_short: float, out_list: list[Reason]) -> None:
        """STOCK/CREDIT/STORAGE_LIMITED for a pair below target (shared by lines and shortfalls)."""
        p, j = key
        sku, tg = skus[p], targets[key]
        margin = sku.margin_inr
        usable = [l for l in snap.depot_lots if l.sku_id == p and l.qty_cases >= 1 and rsl_ok(l, j)
                  and l.depot_id in {x for (x, y_) in lanes if y_ == j}]
        if usable and all(used[l.lot_id] >= l.qty_cases - 1 for l in usable):
            out_list.append(Reason(code=R.STOCK_LIMITED, impact_inr=cases_short * margin, detail=(
                f"Short {cases_short:.0f} cases of target: all usable stock committed; it went where the next "
                f"case was most likely to sell, net of freight.")))
        if not inp.settings.no_credit and snap.credit_available_inr.get(j, math.inf) - value_to[j] < sku.price_inr:
            out_list.append(Reason(code=R.CREDIT_LIMITED, impact_inr=cases_short * margin, detail=(
                f"Capped at {_inr(snap.credit_available_inr[j])} available credit.")))
        if snap.storage_free_m3.get(j, math.inf) - m3_to[j] < sku.m3_per_case:
            out_list.append(Reason(code=R.STORAGE_LIMITED, impact_inr=cases_short * margin, detail=(
                f"Godown full at {nodes[j].storage_m3:.0f} m³.")))

    lines: list[PlanLine] = []
    for line in plan.lines:
        sku, j, w = skus[line.sku_id], line.to_id, line.from_id
        key = (line.sku_id, j)
        lot, tg, pf = lots[line.lot_id], targets.get(key), pairs.get(key)
        cands: list[Reason] = []

        # CHEAPEST_SOURCE: chosen depot has the lowest cost per case among candidates holding a feasible lot
        mine = line.freight_alloc_inr / line.cases
        alts = {}
        for dep in {l.depot_id for l in snap.depot_lots if l.sku_id == line.sku_id and l.qty_cases >= 1
                    and l.depot_id != w and (l.depot_id, j) in lanes and rsl_ok(l, j)}:
            alts[dep] = per_case_cost(dep, j, line.sku_id)
        if alts and mine <= min(alts.values()) + 1e-9:
            dep = min(alts, key=alts.get)
            cands.append(Reason(code=R.CHEAPEST_SOURCE, impact_inr=(alts[dep] - mine) * line.cases, detail=(
                f"From {nodes[w].city} at ₹{mine:,.0f}/case vs ₹{alts[dep]:,.0f}/case from {nodes[dep].city}.")))

        # EXPIRY_PUSH: shortest-RSL lot at that depot, and expected waste here is lower than at the next-best destination
        same = [l for l in snap.depot_lots if l.depot_id == w and l.sku_id == line.sku_id and l.qty_cases >= 1
                and rsl_ok(l, j)]
        if same and lot.expiry_date == min(l.expiry_date for l in same) and pf is not None:
            here = waste(pf, lot, j, line.cases)
            others = [(waste(pairs.get((line.sku_id, k)), lot, k, line.cases), k) for (x, k) in lanes
                      if x == w and k != j and (line.sku_id, k) in pairs and rsl_ok(lot, k)]
            if others:
                alt_waste, k = min(others)
                if alt_waste - here >= MIN_WASTE_GAIN_CASES:
                    mu, _ = window(pf, pf.start, max(line.rsl_on_arrival_days, 1))
                    cands.append(Reason(code=R.EXPIRY_PUSH, impact_inr=(alt_waste - here)
                                        * (sku.landed_cost_inr + sku.disposal_inr) * claim, detail=(
                        f"{line.rsl_on_arrival_days} days on arrival; {nodes[j].city} expected expiry {here:.1f} "
                        f"cases vs {alt_waste:.1f} in {nodes[k].city}.")))

        # CLIFF_RESCUE: lot would cross the MRSL floor before the next cycle
        floor_day = lot.expiry_date.toordinal() - math.ceil((1 - mrsl) * sku.shelf_life_days)
        if (lot.expiry_date - snap.as_of).days - review < mrsl * sku.shelf_life_days:
            cands.append(Reason(code=R.CLIFF_RESCUE, impact_inr=line.cases * (sku.landed_cost_inr + sku.disposal_inr),
                                detail=(f"Lot reaches the {mrsl:.0%} shelf-life floor on {date.fromordinal(floor_day):%d %b}; "
                                        f"shipping now avoids a {_inr(line.cases * (sku.landed_cost_inr + sku.disposal_inr))} write-off.")))

        # FTL_TOPUP: above target on a lane with a paid truck that still had room
        t = trucks.get(line.truck_id) if line.truck_id else None
        if t is not None and tg is not None and z_of(key) > tg.S and t.mode is ShipMode.FTL and max(t.kg_pct, t.m3_pct) < 100:
            h = cfg.costs.holding_rate_annual * sku.landed_cost_inr * review / 365
            cands.append(Reason(code=R.FTL_TOPUP, impact_inr=h * line.cases, detail=(
                f"Fills truck {t.truck_id} to {t.kg_pct:.0f}% by weight / {t.m3_pct:.0f}% by volume; "
                f"added freight ₹0; added holding {_inr(h * line.cases)}.")))

        # FESTIVAL_UPLIFT / WEATHER_SHIFT: factors over the cover window
        if pf is not None and tg is not None:
            n = min(tg.cover_days, len(pf.festival))
            fest = max(pf.festival[:n], default=1.0)
            if fest >= FESTIVAL_MIN:
                names = [f"{k} ×{v:.2f}" for r in weekly[key] for k, v in r.factors.items() if k != "weather" and v >= FESTIVAL_MIN]
                label = names[0] if names else f"Festival ×{fest:.2f}"
                extra = min(line.cases, tg.mu * (1 - 1 / fest))
                cands.append(Reason(code=R.FESTIVAL_UPLIFT, impact_inr=extra * sku.margin_inr,
                                    detail=f"{label} in the {tg.cover_days}-day cover window."))
            wx = sum(pf.weather[:n]) / max(n, 1)
            if wx >= WEATHER_HI or wx <= WEATHER_LO:
                cands.append(Reason(code=R.WEATHER_SHIFT, impact_inr=abs(wx - 1) * tg.mu * sku.margin_inr, detail=(
                    f"Weather {'lifts' if wx > 1 else 'cuts'} demand ×{wx:.2f} over the cover window.")))

            if z_of(key) < tg.S - MIN_SHORT_CASES:
                limit_reasons(key, tg.S - z_of(key), cands)

        # MRSL_BLOCKED: a cheaper depot holds stock but none of it is old enough to ship
        for dep in {l.depot_id for l in snap.depot_lots if l.sku_id == line.sku_id and l.depot_id != w
                    and (l.depot_id, j) in lanes}:
            if depot_blocked(dep, line.sku_id, j) and lanes[(dep, j)].km < lanes[(w, j)].km:
                best = max((l for l in snap.depot_lots if l.depot_id == dep and l.sku_id == line.sku_id),
                           key=lambda l: l.expiry_date)
                rsl_frac = ((best.expiry_date - snap.as_of).days - math.ceil(lanes[(dep, j)].lead_days_mean)) / sku.shelf_life_days
                cands.append(Reason(code=R.MRSL_BLOCKED, impact_inr=(per_case_cost(w, j, line.sku_id) - per_case_cost(dep, j, line.sku_id)) * line.cases
                                    if per_case_cost(w, j, line.sku_id) > per_case_cost(dep, j, line.sku_id) else 0.0, detail=(
                    f"{nodes[dep].city} stock has {rsl_frac:.0%} life on arrival, below the {mrsl:.0%} floor; "
                    f"sourced from {nodes[w].city}.")))
                break

        if not cands:   # the objective picked it on total cost (freight, service and expiry together)
            cands.append(Reason(code=R.CHEAPEST_SOURCE, impact_inr=0.0, detail=(
                f"Lowest total cost incl. service and expiry from {nodes[w].city}; freight ₹{mine:,.0f}/case.")))
        best_two = sorted(cands, key=lambda r: -r.impact_inr)[:MAX_REASONS]
        lines.append(line.model_copy(update={"reasons": best_two}))

    shortfalls: list[Shortfall] = []
    for key, tg in sorted(targets.items()):
        gap = tg.S - z_of(key)
        if gap >= MIN_SHORT_CASES:
            rs: list[Reason] = []
            limit_reasons(key, gap, rs)
            shortfalls.append(Shortfall(sku_id=key[0], dist_id=key[1], short_cases=round(gap, 1),
                                        reasons=sorted(rs, key=lambda r: -r.impact_inr)[:MAX_REASONS]))
    return plan.model_copy(update={"lines": lines, "shortfalls": shortfalls})
