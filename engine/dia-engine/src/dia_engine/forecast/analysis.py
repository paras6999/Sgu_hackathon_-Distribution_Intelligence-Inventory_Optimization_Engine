"""Demand analysis for the web app: the two years of history, the backtest against it, and what the forecaster learned.

Everything here is read from the stored tables and the forecaster's own fitted factors; nothing is re-estimated, so the page
shows exactly what the plans were built on."""
from __future__ import annotations

from datetime import timedelta

import numpy as np
import pandas as pd

from dia_engine import store
from dia_engine.config import get_config
from dia_engine.forecast.forecast import _backtest_table, _data, _factor_weeks, _factors
from dia_types import (
    BacktestPoint, DemandHistory, DemandPoint, FestivalEffect, FestivalWindow, LearnedEffects, WeatherEffect,
)


def demand_history(scenario_id: str, dist_id: str | None = None, sku_id: str | None = None) -> DemandHistory:
    """Weekly true demand over the whole history for one SKU x distributor, or summed over a distributor, a SKU or the network,
    with the backtest forecasts (made 1 to 4 weeks ahead) (a P10-P90 band only for a single pair) and the festival windows."""
    d = _data(scenario_id)
    dist_arr, sku_arr = np.array(d.dist), np.array(d.sku)
    mask = np.ones(d.n_pairs, dtype=bool)
    if dist_id:
        mask &= dist_arr == dist_id
    if sku_id:
        mask &= sku_arr == sku_id
    if not mask.any():
        raise ValueError(f"no pairs for distributor {dist_id!r} and SKU {sku_id!r}")
    weeks = d.y.shape[0] // 7
    weekly = d.y[: weeks * 7, mask].sum(axis=1).reshape(weeks, 7).sum(axis=1)
    starts = [d.start + timedelta(days=7 * i) for i in range(weeks)]

    bt = _backtest_table(scenario_id)           # 12 origins x 4 weeks: 48 consecutive weeks, each forecast 1 to 4 weeks ahead
    bt = bt[bt["sku_id"].isin(sku_arr[mask]) & bt["dist_id"].isin(dist_arr[mask])]
    single = int(mask.sum()) == 1
    g = bt.groupby("week_start")[["actual", "p10", "p50", "p90", "naive"]].sum().reset_index()
    points = []
    for r in g.itertuples():
        lo, hi = (r.p10, r.p90) if single else (r.p50, r.p50)
        points.append(BacktestPoint(week_start=r.week_start, actual=float(r.actual), p10=float(lo), p50=float(r.p50),
                                    p90=float(hi), naive=float(r.naive)))

    skus = store.read_table("skus", scenario_id).set_index("sku_id")
    nodes = store.read_table("nodes", scenario_id).set_index("node_id")
    ev = store.read_table("events", scenario_id)
    ev = ev[ev["event_type"] == "festival"]
    if dist_id:
        ev = ev[ev["region"] == nodes.loc[dist_id, "region"]]
    if sku_id:
        ev = ev[ev["category"] == skus.loc[sku_id, "category"]]
    windows = []
    if len(ev):
        ev = ev.assign(date=pd.to_datetime(ev["date"]))
        for (name, year), g2 in ev.groupby(["name", ev["date"].dt.year]):
            # a festival's run-up can straddle New Year: split on gaps of more than 30 days
            days = np.sort(g2["date"].unique())
            cut = np.where(np.diff(days) > np.timedelta64(30, "D"))[0] + 1
            for chunk in np.split(days, cut):
                windows.append(FestivalWindow(name=str(name), start=pd.Timestamp(chunk[0]).date(), end=pd.Timestamp(chunk[-1]).date()))
    windows.sort(key=lambda w: w.start)

    label = " · ".join(x for x in [nodes.loc[dist_id, "city"] if dist_id else "All distributors",
                                   skus.loc[sku_id, "name"] if sku_id else "all SKUs"])
    return DemandHistory(scenario_id=scenario_id, label=label, dist_id=dist_id, sku_id=sku_id,
                         weekly=[DemandPoint(week_start=s, actual=float(v)) for s, v in zip(starts, weekly)],
                         backtest=points, festivals=windows, has_band=single)


def learned_effects(scenario_id: str) -> LearnedEffects:
    """The seasonal, weather and festival factors the forecaster fitted on the history before the test window, next to the
    values the simulator was configured with (the simulator and model share structure, PRD risk 10, so this is a recovery check).
    The monthly seasonal curve absorbs most of the heat effect because the two move together, so the weather figures are the
    residual sensitivity on top of seasonality, and the seasonal curves are the fair comparison."""
    d = _data(scenario_id)
    cfg = get_config()
    train_weeks = d.day(d.test_start) // 7
    f = _factors(str(store.data_dir()), scenario_id, _factor_weeks(d, train_weeks))
    cats = d.cats
    configured = {fest.name: fest.uplift for fest in cfg.calendar.festivals}

    festivals = []
    for name, mask in d.fest.items():
        hit = mask.any(axis=0)
        learned: dict[str, float] = {}
        for c, cat in enumerate(cats):
            cols = hit & (d.cat_idx == c)
            if cols.any():
                learned[cat] = round(float(np.median(f.uplift[name][cols])), 3)
        festivals.append(FestivalEffect(name=name, learned=learned,
                                        configured={k: float(v) for k, v in configured.get(name, {}).items() if k in learned}))
    festivals.sort(key=lambda x: -max(x.learned.values(), default=1.0))

    weather = [WeatherEffect(category=cat, heat_pct_per_degc_learned=round(float(100 * f.beta[c]), 2),
                             heat_pct_per_degc_configured=round(100 * cfg.categories[cat].heat_beta, 2),
                             rain_cut_pct_learned=round(float(100 * f.cut[c]), 1),
                             rain_cut_pct_configured=round(100 * cfg.categories[cat].rain_cut, 1)) for c, cat in enumerate(cats)]
    return LearnedEffects(scenario_id=scenario_id, festivals=festivals, weather=weather,
                          seasonality={cat: [round(float(v), 3) for v in f.season[c]] for c, cat in enumerate(cats)},
                          seasonality_configured={cat: [round(float(v) / (sum(cfg.categories[cat].season) / 12), 3) for v in cfg.categories[cat].season] for cat in cats})
