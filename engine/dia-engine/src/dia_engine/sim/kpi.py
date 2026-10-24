"""KPIs and experiment summaries, PRD section 8.

Frontier runs reuse the `kpi_results` table (policy, opening_state, seed, kpi, value) without a new column:
a frontier point's rows carry the base policy name and `kpi = "<name>@<param>=<value>"`, for example
`fill_rate@pi_mult=0.25`. `summarise` splits these back out.
"""
from __future__ import annotations

import math
from datetime import timedelta

import numpy as np
import pandas as pd
from scipy import stats

from dia_engine.config import get_config
from dia_types import (
    AblationRow, ExperimentResults, FrontierPoint, KpiSummary, NodeType, OpeningState, PolicyName, Scenario,
)

# Contract: KpiSummary.kpi uses exactly these names (UI labels them).
KPI_NAMES = [
    "fill_rate", "festival_fill_rate", "stockout_rate", "lost_margin_inr", "wastage_inr",
    "freight_inr_per_case", "ftl_utilisation", "cost_to_serve_inr", "cover_extremes", "co2_kg_per_case",
]
HIGHER_IS_BETTER = {"fill_rate", "festival_fill_rate", "ftl_utilisation"}
BASELINES = [PolicyName.BASELINE_A.value, PolicyName.BASELINE_B.value]
COVER_HIGH_X = 3.0       # "above 3 x target cover" (PRD 8.2)
CI_LEVEL = 0.90


def _festival_days(scenario: Scenario) -> set[tuple[str, object]]:
    """(region, date) pairs inside a festival run-up (days_before up to the festival) in the test window."""
    cfg = get_config()
    t0, t1 = cfg.simulation.test_window
    out = set()
    for f in cfg.calendar.festivals:
        for d in f.dates:
            for k in range(f.days_before + 1):
                day = d - timedelta(days=k)
                if t0 <= day <= t1:
                    out.update((r, day) for r in f.regions)
    return out


def compute_kpis(sim_log: pd.DataFrame, sim_trips: pd.DataFrame, scenario: Scenario) -> pd.DataFrame:
    """One row per policy x opening_state x seed x kpi (store table 'kpi_results' columns).

    Distributor rows give demand-side KPIs (sales + lost = true demand). Wastage counts depots and
    distributors. Holding is the config holding rate on landed cost of stock held at every node."""
    cfg = get_config()
    skus = pd.DataFrame([s.model_dump(mode="json") for s in scenario.skus]).set_index("sku_id")
    nodes = pd.DataFrame([n.model_dump(mode="json") for n in scenario.nodes]).set_index("node_id")
    lead = {(l.from_id, l.to_id): l.lead_days_mean for l in scenario.lanes}
    fest = _festival_days(scenario)

    log = sim_log.copy()
    log["is_dist"] = log["node_id"].map(nodes["type"]) == NodeType.DISTRIBUTOR.value
    log["region"] = log["node_id"].map(nodes["region"])
    log["margin"] = log["sku_id"].map(skus["margin_inr"])
    log["unit_loss"] = log["sku_id"].map(skus["landed_cost_inr"]) + log["sku_id"].map(skus["disposal_inr"])
    log["landed"] = log["sku_id"].map(skus["landed_cost_inr"])
    log["demand"] = log["sales"] + log["lost"]
    log["festival"] = [(r, d) in fest for r, d in zip(log["region"], log["date"])]
    keys = ["policy", "opening_state", "seed"]
    trips = sim_trips.assign(util=np.maximum(sim_trips["kg_pct"], sim_trips["m3_pct"]) / 100.0)
    review = cfg.planning.cadence_days
    rows: list[list] = []

    for key, g in log.groupby(keys, sort=True):
        d = g[g["is_dist"]]
        t = trips[(trips["policy"] == key[0]) & (trips["opening_state"] == key[1]) & (trips["seed"] == key[2])]
        demand, sold = d["demand"].sum(), d["sales"].sum()
        fd = d[d["festival"]]
        lost_margin = float((d["lost"] * d["margin"]).sum())
        wastage = float((g["expired"] * g["unit_loss"]).sum())
        holding = float((g["closing"] * g["landed"]).sum() * cfg.costs.holding_rate_annual / 365)
        freight = float(t["cost_inr"].sum())
        delivered = float(d["receipts"].sum())
        ftl = t[t["mode"] == "FTL"]

        demand_days = d.assign(has_demand=d["demand"] > 0)
        stockout = float(((demand_days["closing"] == 0) & demand_days["has_demand"]).sum() / max(len(d), 1))

        # cover extremes: zero stock where demand exists, or stock above 3 x the pair's target cover
        mean_daily = d.groupby(["node_id", "sku_id"])["demand"].transform("mean")
        tc = d["sku_id"].map(skus["temp_class"])
        cover_days = [review[c] + math.ceil(lead.get((nodes.at[n, "home_depot_id"], n), 1.0))
                      for c, n in zip(tc, d["node_id"])]
        target = mean_daily.to_numpy() * np.array(cover_days)
        live = mean_daily.to_numpy() > 0
        extreme = live & ((d["closing"].to_numpy() == 0) | (d["closing"].to_numpy() > COVER_HIGH_X * target))

        kpis = {
            "fill_rate": sold / demand if demand else float("nan"),
            "festival_fill_rate": fd["sales"].sum() / fd["demand"].sum() if fd["demand"].sum() else float("nan"),
            "stockout_rate": stockout,
            "lost_margin_inr": lost_margin,
            "wastage_inr": wastage,
            "freight_inr_per_case": freight / delivered if delivered else float("nan"),
            "ftl_utilisation": float(ftl["util"].mean()) if len(ftl) else float("nan"),
            "cost_to_serve_inr": freight + lost_margin + wastage + holding,
            "cover_extremes": float(extreme.sum() / max(live.sum(), 1)),
            "co2_kg_per_case": float(t["co2_kg"].sum()) / delivered if delivered else float("nan"),
        }
        rows += [[*key, name, float(v)] for name, v in kpis.items()]
    return pd.DataFrame(rows, columns=["policy", "opening_state", "seed", "kpi", "value"])


def _ci(x: np.ndarray) -> tuple[float, float, float]:
    """Mean and the 90% paired-t interval (mean only when fewer than two seeds)."""
    x = x[~np.isnan(x)]
    if len(x) == 0:
        return float("nan"), float("nan"), float("nan")
    m = float(x.mean())
    if len(x) < 2:
        return m, m, m
    half = float(stats.t.ppf(0.5 + CI_LEVEL / 2, len(x) - 1) * x.std(ddof=1) / math.sqrt(len(x)))
    return m, m - half, m + half


def summarise(experiment_id: str, kpi_results: pd.DataFrame) -> ExperimentResults:
    """Means, 90% paired-t CIs, delta vs better baseline per KPI, frontier and ablation rows."""
    plain = kpi_results[~kpi_results["kpi"].str.contains("@")]
    wide = plain.pivot_table(index=["opening_state", "kpi", "seed"], columns="policy", values="value")

    def series(state: str, kpi: str, policy: str) -> pd.Series:
        try:
            return wide.loc[(state, kpi), policy].dropna()
        except KeyError:
            return pd.Series(dtype=float)

    kpis: list[KpiSummary] = []
    headline = [PolicyName.BASELINE_A.value, PolicyName.BASELINE_B.value, PolicyName.ENGINE.value]
    for state in [s.value for s in OpeningState]:
        for kpi in KPI_NAMES:
            base = {b: series(state, kpi, b) for b in BASELINES}
            have = {b: s for b, s in base.items() if len(s)}
            best = None
            if have:
                pick = max if kpi in HIGHER_IS_BETTER else min
                best = pick(have, key=lambda b: have[b].mean())
            for pol in headline:
                s = series(state, kpi, pol)
                if not len(s):
                    continue
                m, lo, hi = _ci(s.to_numpy())
                dm = dlo = dhi = None
                if pol == PolicyName.ENGINE.value and best is not None:
                    diff = (s - have[best]).dropna()
                    if len(diff):
                        dm, dlo, dhi = _ci(diff.to_numpy())
                kpis.append(KpiSummary(policy=pol, opening_state=state, kpi=kpi, mean=m, ci_low=lo, ci_high=hi,
                                       n_seeds=int(len(s)), delta_vs_best_baseline=dm, delta_ci_low=dlo,
                                       delta_ci_high=dhi))

    ablation: list[AblationRow] = []
    variants = sorted(p for p in kpi_results["policy"].unique() if p.startswith("abl_"))
    for state in [s.value for s in OpeningState]:
        for v in variants:
            def delta(kpi: str) -> np.ndarray:
                a, b = series(state, kpi, v), series(state, kpi, PolicyName.ENGINE.value)
                return (a - b).dropna().to_numpy()
            cost = delta("cost_to_serve_inr")
            if not len(cost):
                continue
            m, lo, hi = _ci(cost)
            fill = delta("fill_rate")
            waste = delta("wastage_inr")
            ablation.append(AblationRow(
                variant=v, opening_state=state, delta_cost_to_serve_inr=m, ci_low=lo, ci_high=hi,
                delta_fill_rate_pp=float(fill.mean() * 100) if len(fill) else 0.0,
                delta_wastage_inr=float(waste.mean()) if len(waste) else 0.0))

    frontier: list[FrontierPoint] = []
    pts = kpi_results[kpi_results["kpi"].str.contains("@")].copy()
    if len(pts):
        pts[["name", "tag"]] = pts["kpi"].str.split("@", n=1, expand=True)
        pts[["param", "value_s"]] = pts["tag"].str.split("=", n=1, expand=True)
        for (pol, state, param, val), g in pts.groupby(["policy", "opening_state", "param", "value_s"]):
            fill = g[g["name"] == "fill_rate"]["value"]
            cost = g[g["name"] == "cost_to_serve_inr"]["value"]
            if len(fill) and len(cost):
                frontier.append(FrontierPoint(policy=pol, opening_state=state, param=param, value=float(val),
                                              fill_rate=float(fill.mean()), cost_to_serve_inr=float(cost.mean())))
        frontier.sort(key=lambda p: (p.policy, p.opening_state, p.param, p.value))
    return ExperimentResults(experiment_id=experiment_id, kpis=kpis, frontier=frontier, ablation=ablation)
