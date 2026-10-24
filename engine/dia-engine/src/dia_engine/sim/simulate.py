"""FR-09 Simulation harness, PRD 6.6.5 (owner: M1)."""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from typing import Callable

import numpy as np
import pandas as pd

from dia_engine.baselines.baseline_a import BaselineA
from dia_engine.baselines.baseline_b import BaselineB
from dia_engine import store
from dia_engine.config import get_config
from dia_engine.data.generate import load_scenario
from dia_engine.forecast.forecast import forecast
from dia_engine.forecast.dist import window
from dia_engine.optimize import freight, validate
from dia_types import (
    DistStock, EngineSettings, ExperimentRequest, ForecastMode, InTransit, Lot, NodeType, OpeningState, Snapshot,
    PolicyName, TempClass, TruckClass, Weights,
)
from dia_engine.optimize.pipeline import EnginePolicy
from dia_engine.sim.policy import Policy

# Ablation and policy switches (FR-12). Contract: names match dia_types.PolicyName.
POLICY_SETTINGS: dict[str, EngineSettings] = {
    "engine": EngineSettings(),
    "abl_no_expiry": EngineSettings(no_expiry_term=True),
    "abl_no_truck_steps": EngineSettings(no_truck_steps=True),
    "abl_naive_forecast": EngineSettings(forecast_model=ForecastMode.SEASONAL_NAIVE),
    "abl_no_credit": EngineSettings(no_credit=True),
    "abl_uniform_service": EngineSettings(uniform_service_level=True),
    "abl_home_depot": EngineSettings(home_depot_only=True),
}


def make_policy(name: str, seed: int) -> Policy:
    if name == "baseline_a":
        return BaselineA()
    if name == "baseline_b":
        return BaselineB(seed=seed)
    return EnginePolicy(name, POLICY_SETTINGS[name])


# Imbalanced opening state (FR-09, A24). Placement is deliberate: three different regions so the three
# stresses do not mask one another. Fractions come from the PRD, cover figures from the supply config.
AGED_DEPOT_REGION = "S"                  # depot holding snack lots near the MRSL floor
AGED_RSL_FRACTION = (0.62, 0.70)         # remaining life, just above the 0.60 MRSL (PRD FR-09)
SHORT_REGION = "N"                       # region short of festival-uplifted SKUs before Diwali
SHORT_COVER_DAYS = 2                     # days of forecast demand left on the shelf there
OVERSTOCK_REGION = "W"                   # its smallest distributor is overstocked on slow SKUs
SLOW_SKU_SHARE = 0.25                    # slowest quarter of that distributor's SKUs by forecast


def _stock_expiry(sku, cover: int, as_of: date) -> date:
    """Typical distributor lot: received at the configured share of life used, half a cover period ago."""
    used = get_config().supply.life_used_at_receipt
    life_used = (sum(used.chilled_days) / 2 if sku.temp_class == TempClass.CHILLED
                 else sku.shelf_life_days * sum(used.ambient) / 2)
    return as_of + timedelta(days=max(int(sku.shelf_life_days - life_used - cover / 2), 1))


def get_snapshot(scenario_id: str, as_of: date, opening_state: OpeningState = OpeningState.IMBALANCED) -> Snapshot:
    """State on as_of. On the first test day this is the opening state; later days replay the engine policy."""
    cfg = get_config()
    t0 = cfg.simulation.test_window[0]
    if as_of != t0:
        raise NotImplementedError(f"FR-09: only the first test day ({t0}) has a snapshot until run_policy exists")
    scenario = load_scenario(scenario_id)
    skus = {s.sku_id: s for s in scenario.skus}
    dists = [n for n in scenario.nodes if n.type == NodeType.DISTRIBUTOR]
    lots = [Lot(**r) for r in store.read_table("lots", scenario_id).to_dict("records")]
    fc = forecast(scenario_id, as_of)
    home = {n.node_id: n.home_depot_id for n in scenario.nodes}
    lead = {(l.from_id, l.to_id): l.lead_days_mean for l in scenario.lanes}
    cadence = cfg.planning.cadence_days

    # neutral: every distributor holds forecast demand over its regular cover (R + L) for each SKU.
    # The festival pre-build extension is left out: it is the engine's job and would fill the godown.
    cover = {(pf.sku_id, pf.dist_id): cadence[skus[pf.sku_id].temp_class.value]
             + math.ceil(lead.get((home[pf.dist_id], pf.dist_id), 1.0)) for pf in fc.pairs}
    stock = {(pf.sku_id, pf.dist_id): window(pf, pf.start, cover[(pf.sku_id, pf.dist_id)])[0] for pf in fc.pairs}
    if opening_state == OpeningState.IMBALANCED:
        lots = _age_snack_lots(lots, skus, scenario, as_of)
        _make_short(stock, fc, skus, scenario)
        _overstock_slow(stock, fc, scenario)

    dist_stock = [DistStock(dist_id=j, sku_id=i, qty_cases=float(round(q)),
                            expiry_date=_stock_expiry(skus[i], cover[(i, j)], as_of))
                  for (i, j), q in sorted(stock.items(), key=lambda kv: (kv[0][1], kv[0][0])) if round(q) > 0]

    held_m3: dict[str, float] = defaultdict(float)
    for d in dist_stock:
        held_m3[d.dist_id] += d.qty_cases * skus[d.sku_id].m3_per_case
    # invoices stay outstanding until payment_lag_days after sale: the last week's sales at invoice value
    demand = store.read_table("demand_daily", scenario_id)
    lag = cfg.simulation.payment_lag_days
    recent = demand[(demand["date"] >= as_of - timedelta(days=lag)) & (demand["date"] < as_of)]
    price = recent["sku_id"].map({k: v.price_inr for k, v in skus.items()})
    owed = (recent["sold"] * price).groupby(recent["dist_id"]).sum()
    credit = {n.node_id: float(max(n.credit_limit_inr - owed.get(n.node_id, 0.0), 0.0)) for n in dists}
    free = {n.node_id: float(max(n.storage_m3 - held_m3[n.node_id], 0.0)) for n in dists}
    return Snapshot(scenario_id=scenario_id, as_of=as_of, depot_lots=lots, dist_stock=dist_stock, in_transit=[],
                    credit_available_inr=credit, storage_free_m3=free)


def _age_snack_lots(lots: list[Lot], skus: dict, scenario, as_of: date) -> list[Lot]:
    depot = next(n.node_id for n in scenario.nodes if n.type == NodeType.DEPOT and n.region == AGED_DEPOT_REGION)
    idx = [k for k, l in enumerate(lots) if l.depot_id == depot and skus[l.sku_id].category == "snacks"]
    lo, hi = AGED_RSL_FRACTION
    out = list(lots)
    for n, k in enumerate(idx):
        life = skus[lots[k].sku_id].shelf_life_days
        frac = lo + (hi - lo) * (n / max(len(idx) - 1, 1))
        expiry = as_of + timedelta(days=round(frac * life))
        out[k] = lots[k].model_copy(update={"expiry_date": expiry, "mfg_date": expiry - timedelta(days=life)})
    return out


def _make_short(stock: dict, fc, skus: dict, scenario) -> None:
    """Festival-uplifted SKUs in SHORT_REGION: only SHORT_COVER_DAYS of forecast demand on hand."""
    members = {n.node_id for n in scenario.nodes if n.type == NodeType.DISTRIBUTOR and n.region == SHORT_REGION}
    uplifted = {c for f in get_config().calendar.festivals if f.name == "Diwali" and SHORT_REGION in f.regions
                for c in f.uplift}
    for pf in fc.pairs:
        if pf.dist_id in members and skus[pf.sku_id].category in uplifted:
            key = (pf.sku_id, pf.dist_id)
            stock[key] = min(stock[key], sum(pf.mean[:SHORT_COVER_DAYS]))


def _overstock_slow(stock: dict, fc, scenario) -> None:
    """Smallest distributor of OVERSTOCK_REGION holds the godown's full storage allowance of its slowest SKUs."""
    pop = {d.id: d.population_m for d in get_config().catalogue.distributors}
    dist = min((n.node_id for n in scenario.nodes if n.type == NodeType.DISTRIBUTOR and n.region == OVERSTOCK_REGION),
               key=lambda j: pop[j])
    mine = sorted((pf for pf in fc.pairs if pf.dist_id == dist), key=lambda pf: sum(pf.mean))
    weeks = get_config().supply.distributor_storage_weeks
    for pf in mine[:max(round(len(mine) * SLOW_SKU_SHARE), 1)]:
        key = (pf.sku_id, dist)
        stock[key] = max(stock[key], sum(pf.mean) / len(pf.mean) * 7 * weeks)


@dataclass
class _DepotLot:
    sku_id: str
    depot_id: str
    qty: int
    expiry: date


@dataclass
class _Shipment:
    arrive: date
    to_id: str
    sku_id: str
    lot_id: str
    qty: int
    expiry: date


class SimulationError(AssertionError):
    """Stock conservation or plan validation failed inside the simulator."""


@lru_cache(maxsize=512)
def _forecast_for(data_dir: str, scenario_id: str, as_of: date, mode: str):
    return forecast(scenario_id, as_of, 28, mode)


def _is_plan_day(day: date, t0: date, temp_class: TempClass) -> bool:
    """Chilled every 2nd day from t0; ambient every 7th (Mondays when t0 is a Monday)."""
    every = 2 if temp_class == TempClass.CHILLED else 7
    return (day - t0).days % every == 0


def run_policy(scenario_id: str, policy: Policy, opening_state: OpeningState, seed: int,
               ) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Daily loop over the test window. Returns (sim_log, sim_trips) with store.TABLES columns.
    Enforces credit cuts identically for every policy and asserts stock conservation every day.

    Demand comes from the scenario's `demand_daily` (identical for every policy); shipment delays are drawn
    from a generator keyed on (seed, day, lane, class), so they are identical too. In sim_log a depot's
    `sales` column holds cases dispatched, a distributor's holds cases sold to outlets."""
    cfg = get_config()
    t0, t1 = cfg.simulation.test_window
    days = [t0 + timedelta(days=i) for i in range((t1 - t0).days + 1)]
    sc = load_scenario(scenario_id)
    skus = {s.sku_id: s for s in sc.skus}
    nodes = {n.node_id: n for n in sc.nodes}
    depots = [n.node_id for n in sc.nodes if n.type == NodeType.DEPOT]
    dists = [n.node_id for n in sc.nodes if n.type == NodeType.DISTRIBUTOR]
    lanes = {(l.from_id, l.to_id): l for l in sc.lanes}
    lane_index = {k: i for i, k in enumerate(sorted(lanes))}
    sku_ids = [s.sku_id for s in sc.skus]
    ddir = str(store.data_dir())
    mode = ForecastMode(getattr(getattr(policy, "settings", None), "forecast_model", ForecastMode.FULL)).value

    demand_tbl = store.read_table("demand_daily", scenario_id)
    window_tbl = demand_tbl[(demand_tbl["date"] >= t0) & (demand_tbl["date"] <= t1)]
    demand: dict[date, dict[tuple[str, str], int]] = defaultdict(dict)
    for d, j, i, q in zip(window_tbl["date"], window_tbl["dist_id"], window_tbl["sku_id"], window_tbl["true_demand"]):
        demand[d][(j, i)] = int(q)
    receipts_by_day: dict[date, list] = defaultdict(list)
    for r in store.read_table("plant_receipts", scenario_id).to_dict("records"):
        receipts_by_day[r["date"]].append(r)

    # ---- opening state
    snap0 = get_snapshot(scenario_id, t0, opening_state)
    depot_lots = {l.lot_id: _DepotLot(l.sku_id, l.depot_id, int(round(l.qty_cases)), l.expiry_date)
                  for l in snap0.depot_lots}
    dist_lots: dict[tuple[str, str], list[list]] = defaultdict(list)     # [expiry, qty, lot_id]
    for n, d in enumerate(snap0.dist_stock):
        dist_lots[(d.dist_id, d.sku_id)].append([d.expiry_date, int(round(d.qty_cases)), d.lot_id or f"OPEN-{n:05d}"])
    in_transit: list[_Shipment] = []
    outstanding = {j: nodes[j].credit_limit_inr - snap0.credit_available_inr[j] for j in dists}
    payments: dict[date, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    lag = cfg.simulation.payment_lag_days
    hist = demand_tbl[(demand_tbl["date"] >= t0 - timedelta(days=lag)) & (demand_tbl["date"] < t0)]
    for d, j, i, q in zip(hist["date"], hist["dist_id"], hist["sku_id"], hist["sold"]):
        payments[d + timedelta(days=lag)][j] += q * skus[i].price_inr

    def totals() -> dict[tuple[str, str], int]:
        out: dict[tuple[str, str], int] = defaultdict(int)
        for l in depot_lots.values():
            out[(l.depot_id, l.sku_id)] += l.qty
        for (j, i), ls in dist_lots.items():
            out[(j, i)] += sum(x[1] for x in ls)
        return out

    def snapshot(day: date) -> Snapshot:
        held = defaultdict(float)
        stock = []
        for (j, i), ls in sorted(dist_lots.items()):
            for exp, q, lot in ls:
                if q > 0:
                    stock.append(DistStock(dist_id=j, sku_id=i, lot_id=lot, qty_cases=float(q), expiry_date=exp))
                    held[j] += q * skus[i].m3_per_case
        for sh in in_transit:
            held[sh.to_id] += sh.qty * skus[sh.sku_id].m3_per_case
        return Snapshot(
            scenario_id=scenario_id, as_of=day,
            depot_lots=[Lot(lot_id=k, sku_id=l.sku_id, depot_id=l.depot_id, qty_cases=float(l.qty),
                            mfg_date=l.expiry - timedelta(days=skus[l.sku_id].shelf_life_days), expiry_date=l.expiry)
                        for k, l in sorted(depot_lots.items()) if l.qty >= 1],
            dist_stock=stock,
            in_transit=[InTransit(to_id=sh.to_id, sku_id=sh.sku_id, lot_id=sh.lot_id, qty_cases=float(sh.qty),
                                  eta=sh.arrive, expiry_date=sh.expiry) for sh in in_transit],
            credit_available_inr={j: max(nodes[j].credit_limit_inr - outstanding[j], 0.0) for j in dists},
            storage_free_m3={j: max(nodes[j].storage_m3 - held[j], 0.0) for j in dists})

    log_rows: list[list] = []
    trip_rows: list[list] = []
    tag = [seed, policy.name, opening_state.value]

    for day in days:
        opening = totals()
        receipts: dict[tuple[str, str], int] = defaultdict(int)
        out_: dict[tuple[str, str], int] = defaultdict(int)       # sales (distributor) or dispatch (depot)
        lost: dict[tuple[str, str], int] = defaultdict(int)
        expired: dict[tuple[str, str], int] = defaultdict(int)
        cut: dict[tuple[str, str], int] = defaultdict(int)

        # ---- plant receipts land at the depot before dispatch, so fresh dairy can ship the day it is made.
        # (PRD 6.6.5 lists them after planning; that leaves 2-day-old dairy below the 60% shelf-life floor.)
        for r in receipts_by_day.get(day, ()):
            depot_lots[r["lot_id"]] = _DepotLot(r["sku_id"], r["depot_id"], int(r["qty_cases"]), r["expiry_date"])
            receipts[(r["depot_id"], r["sku_id"])] += int(r["qty_cases"])

        # ---- planning and dispatch
        for ci, tc in enumerate((TempClass.CHILLED, TempClass.AMBIENT)):
            if not _is_plan_day(day, t0, tc):
                continue
            snap = snapshot(day)
            plan = policy.plan(sc, snap, _forecast_for(ddir, scenario_id, day, mode), tc)
            report = validate.validate_plan(plan, sc, snap, [], require_reasons=False)
            if not report.ok:
                raise SimulationError(f"{policy.name} {day} {tc.value}: {report.violations[:3]}")
            plan = _enforce_credit(plan, snap, skus, cut)
            for line in plan.lines:
                lane = lanes[(line.from_id, line.to_id)]
                rng = np.random.default_rng([seed, day.toordinal(), lane_index[(line.from_id, line.to_id)], ci])
                extra = 1 if rng.random() < lane.p_delay else 0
                lot = depot_lots[line.lot_id]
                if lot.qty < line.cases:
                    raise SimulationError(f"{policy.name} {day}: lot {line.lot_id} has {lot.qty}, line ships {line.cases}")
                lot.qty -= line.cases
                out_[(line.from_id, line.sku_id)] += line.cases
                outstanding[line.to_id] += line.cases * skus[line.sku_id].price_inr
                in_transit.append(_Shipment(day + timedelta(days=math.ceil(lane.lead_days_mean) + extra), line.to_id,
                                            line.sku_id, line.lot_id, line.cases, line.expiry))
            for t in plan.trucks:
                lane = lanes[(t.from_id, t.to_id)]
                co2 = (lane.co2_kg_per_trip[t.truck_class.value] if t.truck_class is not None else
                       lane.co2_kg_per_trip["AMB32"] / (freight.capacity(TruckClass.AMB32).kg * cfg.carbon.ptl_load_factor) * t.kg)
                trip_rows.append([*tag, day, t.truck_id, t.mode.value, t.from_id, t.to_id, t.kg_pct, t.m3_pct,
                                  t.cost_inr, co2])

        # ---- arrivals
        due = [sh for sh in in_transit if sh.arrive <= day]
        in_transit = [sh for sh in in_transit if sh.arrive > day]
        for sh in due:
            dist_lots[(sh.to_id, sh.sku_id)].append([sh.expiry, sh.qty, sh.lot_id])
            receipts[(sh.to_id, sh.sku_id)] += sh.qty

        # ---- sales (FEFO), settle credit
        sold_value: dict[str, float] = defaultdict(float)
        for (j, i), want in demand[day].items():
            ls = sorted(dist_lots.get((j, i), []), key=lambda x: (x[0], x[2]))
            left = want
            for x in ls:
                take = min(left, x[1])
                x[1] -= take
                left -= take
                if left == 0:
                    break
            sold = want - left
            out_[(j, i)] += sold
            lost[(j, i)] += left
            sold_value[j] += sold * skus[i].price_inr
        for j, v in payments.pop(day, {}).items():
            outstanding[j] = max(outstanding[j] - v, 0.0)
        for j, v in sold_value.items():
            payments[day + timedelta(days=lag)][j] += v

        # ---- expiry
        for l in depot_lots.values():
            if l.expiry <= day and l.qty > 0:
                expired[(l.depot_id, l.sku_id)] += l.qty
                l.qty = 0
        for (j, i), ls in dist_lots.items():
            for x in ls:
                if x[0] <= day and x[1] > 0:
                    expired[(j, i)] += x[1]
                    x[1] = 0
            dist_lots[(j, i)] = [x for x in ls if x[1] > 0]
        depot_lots = {k: l for k, l in depot_lots.items() if l.qty > 0}

        # ---- conservation: opening + receipts - sales - expired = closing, on every node x SKU
        closing = totals()
        for n in depots + dists:
            for i in sku_ids:
                k = (n, i)
                o, r, s_, e = opening.get(k, 0), receipts.get(k, 0), out_.get(k, 0), expired.get(k, 0)
                c = closing.get(k, 0)
                if o + r - s_ - e != c:
                    raise SimulationError(f"conservation {policy.name} {day} {n} {i}: {o}+{r}-{s_}-{e} != {c}")
                log_rows.append([*tag, day, n, i, o, r, s_, lost.get(k, 0), e, cut.get(k, 0), c])

    sim_log = pd.DataFrame(log_rows, columns=store.TABLES["sim_log"][1])
    sim_trips = pd.DataFrame(trip_rows, columns=store.TABLES["sim_trips"][1])
    return sim_log, sim_trips


def _enforce_credit(plan, snap: Snapshot, skus: dict, cut: dict):
    """Same rule for every policy: a distributor's shipments above credit available are cut pro rata across its
    lines (whole cases, rounded down). Cut cases stay at the depot and are logged as credit_cut."""
    value: dict[str, float] = defaultdict(float)
    for l in plan.lines:
        value[l.to_id] += l.cases * skus[l.sku_id].price_inr
    factor = {j: min(snap.credit_available_inr.get(j, math.inf) / v, 1.0) for j, v in value.items() if v > 0}
    if all(f >= 1.0 for f in factor.values()):
        return plan
    lines = []
    for l in plan.lines:
        n = int(math.floor(l.cases * factor.get(l.to_id, 1.0) + 1e-9))
        if n < l.cases:
            cut[(l.to_id, l.sku_id)] += l.cases - n
        if n > 0:
            lines.append(l.model_copy(update={"cases": n}))
    by_truck: dict[str, list] = defaultdict(list)
    for l in lines:
        by_truck[l.truck_id or l.consignment_id].append(l)
    trucks = []
    for t in plan.trucks:
        ls = by_truck.get(t.truck_id)
        if not ls:
            continue
        kg = sum(l.cases * skus[l.sku_id].kg_per_case for l in ls)
        m3 = sum(l.cases * skus[l.sku_id].m3_per_case for l in ls)
        scale_kg, scale_m3 = (kg / t.kg if t.kg else 1.0), (m3 / t.m3 if t.m3 else 1.0)
        trucks.append(t.model_copy(update={"kg": kg, "m3": m3, "kg_pct": t.kg_pct * scale_kg,
                                           "m3_pct": t.m3_pct * scale_m3, "line_ids": [l.line_id for l in ls]}))
    return plan.model_copy(update={"lines": lines, "trucks": trucks})


SIM_TIME_LIMIT_S = 1.0      # per-solve cap for the engine inside experiments (the API default is 30 s)
SUBSET_SEEDS = 10           # ablations and non-default frontier points (FR-09)
KEEP_LOG_SEEDS = 2          # sim_log / sim_trips are stored for the first seeds only; KPIs for every run
FRONTIER = {                # (parameter, values) per policy (FR-11); the default value is added from the headline run
    "engine": ("pi_mult", [0.25, 0.5, 2.0, 4.0], 1.0),
    "baseline_b": ("service_level", [0.80, 0.90, 0.98, 0.995], 0.95),
    "baseline_a": ("cover_days", [7, 10, 21], 14),
}
FRONTIER_KPIS = ("fill_rate", "cost_to_serve_inr")


def _frontier_policy(name: str, value: float, seed: int) -> Policy:
    if name == "engine":
        return EnginePolicy("engine", EngineSettings(weights=Weights(pi_mult=value), time_limit_s=SIM_TIME_LIMIT_S))
    if name == "baseline_b":
        return BaselineB(service_level=value, seed=seed)
    return BaselineA(cover_days=int(value))


def _policy_for(name: str, seed: int) -> Policy:
    if name in POLICY_SETTINGS:
        return EnginePolicy(name, POLICY_SETTINGS[name].model_copy(update={"time_limit_s": SIM_TIME_LIMIT_S}))
    return make_policy(name, seed)


def _run_seed(task: tuple) -> tuple[int, list, list, list]:
    """One seed: every opening state and policy in this process, so the rolling forecasts are computed once.
    Returns (seed, kpi rows, sim_log frames, sim_trips frames)."""
    from dia_engine.sim import kpi
    seed, headline, extra, states = task
    sid = _ensure_scenario(seed)
    sc = load_scenario(sid)
    rows: list = []
    logs: list = []
    trips: list = []

    def keep(df: pd.DataFrame, tag: str | None, names=None) -> None:
        if names is not None:
            df = df[df["kpi"].isin(names)]
        if tag:
            df = df.assign(kpi=df["kpi"] + tag)
        rows.append(df)

    for state in states:
        for name in headline:
            pol = _policy_for(name, seed)
            log, trip = run_policy(sid, pol, state, seed)
            k = kpi.compute_kpis(log, trip, sc)
            keep(k, None)
            if name in FRONTIER and seed <= SUBSET_SEEDS:
                param, _, default = FRONTIER[name]
                keep(k, f"@{param}={default}", FRONTIER_KPIS)
            if seed <= KEEP_LOG_SEEDS:
                logs.append(log)
                trips.append(trip)
        if seed > SUBSET_SEEDS:
            continue
        for name in extra:                       # ablations
            log, trip = run_policy(sid, _policy_for(name, seed), state, seed)
            keep(kpi.compute_kpis(log, trip, sc), None)
        for name in headline:                    # non-default frontier points
            if name not in FRONTIER:
                continue
            param, values, _ = FRONTIER[name]
            for v in values:
                log, trip = run_policy(sid, _frontier_policy(name, v, seed), state, seed)
                keep(kpi.compute_kpis(log, trip, sc).assign(policy=name), f"@{param}={v}", FRONTIER_KPIS)
    return seed, rows, logs, trips


def _ensure_scenario(seed: int) -> str:
    from dia_engine.data.generate import generate, scenario_id_for
    sid = scenario_id_for(seed)
    if not store.table_exists("nodes", sid):
        generate(get_config(), seed)
    return sid


def run_experiment(experiment_id: str, req: ExperimentRequest,
                   progress: Callable[[float], None] | None = None) -> None:
    """Run all seeds x opening states x policies in parallel; write sim_log, sim_trips and kpi_results
    via dia_engine.store, then store.save_results(kpi.summarise(...)).

    Headline policies (engine, baselines) run on every seed; ablations and non-default frontier points on the
    first SUBSET_SEEDS. One process per seed. Seed k uses scenario seedNN (generated if missing) and delay
    draws keyed on k."""
    import os
    from concurrent.futures import ProcessPoolExecutor, as_completed
    from dia_engine.sim import kpi

    os.environ.setdefault("OMP_NUM_THREADS", "1")          # one solver thread per process (determinism, no oversubscription)
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
    names = [PolicyName(p).value for p in req.policies]
    headline = [n for n in names if not n.startswith("abl_")]
    extra = [n for n in names if n.startswith("abl_")]
    states = [OpeningState(s) for s in req.opening_states]
    tasks = [(seed, headline, extra, states) for seed in range(1, req.seeds + 1)]
    workers = max(1, min(len(tasks), (os.cpu_count() or 2) - 1, 8))
    done: list[tuple] = []
    if progress:
        progress(0.0)
    if workers == 1:
        for t in tasks:
            done.append(_run_seed(t))
            if progress:
                progress(100.0 * len(done) / len(tasks))
    else:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            for fut in as_completed([pool.submit(_run_seed, t) for t in tasks]):
                done.append(fut.result())
                if progress:
                    progress(100.0 * len(done) / len(tasks))
    done.sort(key=lambda r: r[0])
    frames = [df for _, rows, _, _ in done for df in rows]
    results = pd.concat(frames, ignore_index=True)[["policy", "opening_state", "seed", "kpi", "value"]]
    store.write_table("kpi_results", results, experiment_id)
    logs = [df for _, _, ls, _ in done for df in ls]
    trips = [df for _, _, _, ts in done for df in ts]
    if logs:
        store.write_table("sim_log", pd.concat(logs, ignore_index=True), experiment_id)
        store.write_table("sim_trips", pd.concat(trips, ignore_index=True), experiment_id)
    store.save_results(kpi.summarise(experiment_id, results))
