"""FR-03 Demand forecast (owner: M2). PRD 6.6.1.

  daily mean = level(week) / 7 x weekday(dist, category) x season(category, month)
               x festival uplift(name, category, region) x (1 + beta x heat) x (1 - cut x heavy rain)

* level: ETS fitted on the factor-adjusted weekly series. Smooth series pick simple vs damped-trend
  exponential smoothing per series by AIC (what AutoETS does without seasonality, which the factors
  carry); intermittent series (ADI > 1.32, Syntetos-Boylan) use TSB. Vectorised NumPy over all pairs,
  because statsforecast took 28 s to import and 7.5 s per 384-series fit, too slow for the weekly
  simulation refits and a numba risk for the binary.
* factors are learned from history only: season = mean ratio to a 9-week rolling median on
  non-festival weeks; weather by OLS on non-festival weeks; festival uplift = median implied uplift.
  Festival names and dates come from the `events` calendar; their factor values are never read.
* weather inside the horizon: actual + noise for the first `weather_forecast_days`, city x week-of-year
  climatology after that (no perfect foresight).
* bands: empirical ratio quantiles (actual / P50) per category x horizon week from the 12-origin
  backtest. Weekly variance is spread over days in proportion to each day's mean (A27).
* factors refit every `param_refit_weeks` (anchored at the test start); the level refits every week.

Only `demand_daily` rows with date < as_of are used.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from typing import Literal

import numpy as np
import pandas as pd

from dia_engine import store
from dia_engine.config import get_config
from dia_types import BacktestMetrics, ForecastBundle, ForecastModelKind, ForecastRow, PairForecast

Z90 = 1.2815515655446004
N_ORIGINS = 12
BACKTEST_WEEKS = 4
ADI_INTERMITTENT = 1.32
ROLL_WEEKS = 9
Mode = Literal["full", "seasonal_naive"]


# --------------------------------------------------------------------------- data

@dataclass(frozen=True)
class _Data:
    sid: str
    start: date                    # first history day (a Monday)
    test_start: date
    y: np.ndarray                  # [day, pair] true demand (A20)
    sku: list[str]
    dist: list[str]
    cat_idx: np.ndarray            # [pair]
    cats: list[str]
    region: np.ndarray             # [pair]
    group: np.ndarray              # [pair] distributor x category, for pooled weekday profiles
    tmax: np.ndarray               # [day, pair]
    precip: np.ndarray             # [day, pair]
    fest: dict[str, np.ndarray]    # festival name -> [day, pair] bool

    @property
    def n_pairs(self) -> int:
        return self.y.shape[1]

    def day(self, d: date) -> int:
        return (d - self.start).days


@lru_cache(maxsize=4)
def _load(data_dir: str, sid: str) -> _Data:
    dd = store.read_table("demand_daily", sid)
    skus = store.read_table("skus", sid).set_index("sku_id")
    nodes = store.read_table("nodes", sid).set_index("node_id")
    events = store.read_table("events", sid)
    weather = store.read_table("weather_daily")

    piv = dd.pivot(index="date", columns=["sku_id", "dist_id"], values="true_demand").sort_index()
    dates = pd.to_datetime(piv.index)
    start = dates[0].date()
    if start.weekday() != 0:
        raise ValueError("demand history must start on a Monday")
    sku = [c[0] for c in piv.columns]
    dist = [c[1] for c in piv.columns]
    cats = sorted(skus["category"].unique())
    cat_idx = np.array([cats.index(skus.loc[s, "category"]) for s in sku])
    region = nodes.loc[dist, "region"].to_numpy()
    dists = sorted(set(dist))
    group = np.array([dists.index(d) * len(cats) + c for d, c in zip(dist, cat_idx)])

    w = weather.assign(date=pd.to_datetime(weather["date"])).pivot(index="date", columns="city").reindex(dates)
    cities = nodes.loc[dist, "city"].to_list()
    tmax = w["tmax_c"][cities].to_numpy(dtype=float)
    precip = w["precip_mm"][cities].to_numpy(dtype=float)

    fest: dict[str, np.ndarray] = {}
    day_of = {d: i for i, d in enumerate(dates.date)}
    pair_key = pd.Series(range(len(sku)), index=pd.MultiIndex.from_arrays([region, [cats[c] for c in cat_idx]]))
    for name, rows in events[events["event_type"] == "festival"].groupby("name"):
        m = np.zeros((len(dates), len(sku)), dtype=bool)
        for r in rows.itertuples():
            if r.date in day_of and (r.region, r.category) in pair_key.index:
                m[day_of[r.date], pair_key.loc[[(r.region, r.category)]].to_numpy()] = True
        fest[name] = m
    cfg = get_config()
    return _Data(sid, start, cfg.simulation.test_window[0], piv.to_numpy(dtype=float), sku, dist, cat_idx, cats,
                 region, group, tmax, precip, fest)


def _data(sid: str) -> _Data:
    return _load(str(store.data_dir()), sid)


# --------------------------------------------------------------------------- factors

@dataclass(frozen=True)
class _Factors:
    season: np.ndarray             # [cat, 12]
    beta: np.ndarray               # [cat] uplift per degC above 32
    cut: np.ndarray                # [cat] demand cut on a heavy-rain day
    uplift: dict[str, np.ndarray]  # festival -> [pair]
    weekday: np.ndarray            # [7, pair], mean 1
    clim_heat: np.ndarray          # [53, pair] mean daily heat excess by ISO week
    clim_rain: np.ndarray          # [53, pair] P(heavy rain) by ISO week


def _weeks(a: np.ndarray, n_weeks: int, how: str = "sum") -> np.ndarray:
    r = a[: n_weeks * 7].reshape(n_weeks, 7, -1)
    return r.sum(1) if how == "sum" else r.mean(1) if how == "mean" else r.any(1)


@lru_cache(maxsize=16)
def _factors(data_dir: str, sid: str, train_weeks: int) -> _Factors:
    d = _load(data_dir, sid)
    n_days = train_weeks * 7
    y = d.y[:n_days]
    days = pd.date_range(d.start, periods=n_days, freq="D")
    fest_any = np.zeros_like(y, dtype=bool)
    for m in d.fest.values():
        fest_any |= m[:n_days]

    yw = _weeks(y, train_weeks)
    base = pd.DataFrame(yw).rolling(ROLL_WEEKS, center=True, min_periods=3).median().to_numpy()
    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = np.where(base > 0, yw / base, np.nan)
    week_month = (pd.DatetimeIndex(days[3::7]).month.to_numpy() - 1)[:train_weeks]
    fest_week = _weeks(fest_any, train_weeks, "any")
    clean = np.isfinite(ratio) & (ratio > 0) & ~fest_week

    n_cat = len(d.cats)
    season = np.ones((n_cat, 12))
    for c in range(n_cat):
        cols = d.cat_idx == c
        for m in range(12):
            v = ratio[week_month == m][:, cols][clean[week_month == m][:, cols]]
            if v.size:
                season[c, m] = v.mean()
    season /= season.mean(axis=1, keepdims=True)

    heat = np.maximum(0.0, d.tmax[:n_days] - 32.0)
    rain = d.precip[:n_days] > 20.0
    heat_w, rain_w = _weeks(heat, train_weeks, "mean"), _weeks(rain.astype(float), train_weeks, "mean")
    s_week = season[d.cat_idx][:, week_month].T                                  # [week, pair]
    beta, cut = np.zeros(n_cat), np.zeros(n_cat)
    for c in range(n_cat):
        cols = d.cat_idx == c
        ok = clean[:, cols]
        t = np.log(ratio[:, cols][ok] / s_week[:, cols][ok])
        x = np.column_stack([np.ones(t.size), heat_w[:, cols][ok], rain_w[:, cols][ok]])
        if t.size > 30:
            coef = np.linalg.lstsq(x, t, rcond=None)[0]
            beta[c] = float(np.clip(coef[1], 0.0, 0.1))
            cut[c] = float(np.clip(-coef[2], 0.0, 0.6))
    weather_w = _weeks((1 + beta[d.cat_idx] * heat) * (1 - cut[d.cat_idx] * rain), train_weeks, "mean")

    uplift: dict[str, np.ndarray] = {}
    for name, mask in d.fest.items():
        k = _weeks(mask[:n_days].astype(float), train_weeks)                     # festival days per week
        u = np.ones(d.n_pairs)
        hit = (k > 0) & np.isfinite(ratio)
        implied = 1 + 7 * (ratio / (s_week * weather_w) - 1) / np.where(k > 0, k, 1)
        key = pd.Series(list(zip(d.cat_idx, d.region)))
        for (c, r), idx in key.groupby(key).groups.items():
            v = implied[:, idx][hit[:, idx]]
            if v.size:
                u[idx] = float(np.clip(np.median(v), 1.0, 3.0))
        uplift[name] = u

    dow = np.arange(n_days) % 7
    weekday = np.ones((7, d.n_pairs))
    yc = np.where(fest_any, np.nan, y)
    by_dow = np.vstack([np.nanmean(yc[dow == k], axis=0) for k in range(7)])     # [7, pair]
    for g in np.unique(d.group):
        cols = d.group == g
        prof = np.nansum(by_dow[:, cols], axis=1)
        if prof.mean() > 0:
            weekday[:, cols] = (prof / prof.mean())[:, None]

    woy = np.minimum(days.isocalendar().week.to_numpy(dtype=int), 53) - 1
    clim_heat, clim_rain = np.zeros((53, d.n_pairs)), np.zeros((53, d.n_pairs))
    for wk in range(53):
        sel = woy == wk
        if sel.any():
            clim_heat[wk], clim_rain[wk] = heat[sel].mean(0), rain[sel].mean(0)
    return _Factors(season, beta, cut, uplift, weekday, clim_heat, clim_rain)


def _day_factor(d: _Data, f: _Factors, day0: int, n: int, heat: np.ndarray, rain_eff: np.ndarray,
                ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(seasonal x weekday x festival x weather, festival, weather) for days [day0, day0 + n)."""
    idx = np.arange(day0, day0 + n)
    months = pd.DatetimeIndex([d.start + timedelta(days=int(i)) for i in idx]).month.to_numpy() - 1
    season = f.season[d.cat_idx][:, months].T
    fest = np.ones((n, d.n_pairs))
    for name, mask in d.fest.items():
        inside = idx < mask.shape[0]
        m = np.zeros((n, d.n_pairs), dtype=bool)
        m[inside] = mask[idx[inside]]
        fest = np.where(m, fest * f.uplift[name], fest)
    weather = (1 + f.beta[d.cat_idx] * heat) * (1 - f.cut[d.cat_idx] * rain_eff)
    return season * f.weekday[idx % 7] * fest * weather, fest, weather


def _history_weather(d: _Data, f: _Factors, day0: int, n: int) -> tuple[np.ndarray, np.ndarray]:
    return np.maximum(0.0, d.tmax[day0:day0 + n] - 32.0), (d.precip[day0:day0 + n] > 20.0).astype(float)


def _horizon_weather(d: _Data, f: _Factors, day0: int, n: int) -> tuple[np.ndarray, np.ndarray]:
    """Noisy actuals for the first weather_forecast_days, climatology after (FR-02)."""
    cfg = get_config().forecast
    seed = int(hashlib.sha256(f"{d.sid}|{day0}".encode()).hexdigest()[:8], 16)
    rng = np.random.default_rng(seed)
    heat, rain = np.zeros((n, d.n_pairs)), np.zeros((n, d.n_pairs))
    for i in range(n):
        day = day0 + i
        if i < cfg.weather_forecast_days and day < d.tmax.shape[0]:
            t = d.tmax[day] + rng.normal(0, cfg.weather_noise.tmax_sd_c, d.n_pairs)
            p = d.precip[day] * (1 + rng.uniform(-cfg.weather_noise.rain_rel, cfg.weather_noise.rain_rel, d.n_pairs))
            heat[i], rain[i] = np.maximum(0.0, t - 32.0), (p > 20.0)
        else:
            wk = min((d.start + timedelta(days=day)).isocalendar().week, 53) - 1
            heat[i], rain[i] = f.clim_heat[wk], f.clim_rain[wk]
    return heat, rain


# --------------------------------------------------------------------------- level models

ALPHAS = np.array([0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6])
DAMPED = [(a, b) for a in (0.05, 0.1, 0.2, 0.3, 0.5) for b in (0.02, 0.05, 0.1)]
PHI = 0.9


def _ets(a: np.ndarray, steps: int) -> np.ndarray:
    """Per-series choice of ETS(A,N,N) vs ETS(A,Ad,N) by AIC; returns [steps, pair] level forecasts."""
    t_len, n = a.shape
    l0 = a[:4].mean(0)
    l = np.repeat(l0[None], len(ALPHAS), 0)
    sse = np.zeros_like(l)
    for t in range(t_len):
        e = a[t] - l
        sse += e * e
        l = l + ALPHAS[:, None] * e
    best_s = sse.argmin(0)
    aic_s = t_len * np.log(sse[best_s, np.arange(n)] / t_len + 1e-12) + 4
    fc_s = l[best_s, np.arange(n)]

    al = np.array([p[0] for p in DAMPED])[:, None]
    be = np.array([p[1] for p in DAMPED])[:, None]
    l = np.repeat(l0[None], len(DAMPED), 0)
    b = np.zeros_like(l)
    sse = np.zeros_like(l)
    for t in range(t_len):
        pred = l + PHI * b
        e = a[t] - pred
        sse += e * e
        l = pred + al * e
        b = PHI * b + al * be * e
    best_d = sse.argmin(0)
    aic_d = t_len * np.log(sse[best_d, np.arange(n)] / t_len + 1e-12) + 8
    ld, bd = l[best_d, np.arange(n)], b[best_d, np.arange(n)]

    damp = np.cumsum(PHI ** np.arange(1, steps + 1))[:, None]
    fc_d = ld[None] + damp * bd[None]
    out = np.where((aic_d < aic_s)[None], fc_d, np.repeat(fc_s[None], steps, 0))
    return np.maximum(out, 0.0)


def _tsb(a: np.ndarray, alpha_d: float = 0.2, alpha_p: float = 0.1) -> np.ndarray:
    nz = a > 0
    z = np.where(nz.any(0), (a * nz).sum(0) / np.maximum(nz.sum(0), 1), 0.0)
    p = nz[:8].mean(0)
    for t in range(a.shape[0]):
        z = np.where(nz[t], z + alpha_d * (a[t] - z), z)
        p = p + alpha_p * (nz[t] - p)
    return p * z


@lru_cache(maxsize=64)
def _levels(data_dir: str, sid: str, train_weeks: int, factor_weeks: int, steps: int) -> tuple[np.ndarray, np.ndarray]:
    """([steps, pair] weekly level forecasts, [pair] intermittent flag) from weeks [0, train_weeks)."""
    d = _load(data_dir, sid)
    f = _factors(data_dir, sid, factor_weeks)
    n_days = train_weeks * 7
    heat, rain = _history_weather(d, f, 0, n_days)
    fac, _, _ = _day_factor(d, f, 0, n_days, heat, rain)
    denom = _weeks(fac, train_weeks) / 7.0
    with np.errstate(divide="ignore", invalid="ignore"):
        adj = np.where(denom > 0, _weeks(d.y[:n_days], train_weeks) / denom, 0.0)
    nonzero = (adj > 0).sum(0)
    adi = np.where(nonzero > 0, train_weeks / np.maximum(nonzero, 1), np.inf)
    intermittent = adi > ADI_INTERMITTENT
    lev = _ets(adj, steps)
    if intermittent.any():
        lev[:, intermittent] = _tsb(adj[:, intermittent])[None]
    return lev, intermittent


def _factor_weeks(d: _Data, train_weeks: int) -> int:
    """Factors refit every param_refit_weeks, anchored at the test start; before it, at every origin."""
    test_weeks = d.day(d.test_start) // 7
    k = get_config().forecast.param_refit_weeks
    return train_weeks if train_weeks < test_weeks else test_weeks + k * ((train_weeks - test_weeks) // k)


def _daily_mean(d: _Data, as_of_day: int, n_days: int, mode: Mode) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, int]:
    """Point forecast [n_days, pair] from as_of_day, plus festival / weather factors, intermittent flag, train weeks."""
    train_weeks = as_of_day // 7
    f = _factors(str(store.data_dir()), d.sid, _factor_weeks(d, train_weeks))
    heat, rain = _horizon_weather(d, f, as_of_day, n_days)
    fac, fest, weather = _day_factor(d, f, as_of_day, n_days, heat, rain)
    week = (np.arange(as_of_day, as_of_day + n_days) // 7) - train_weeks          # 0 = week containing as_of
    if mode == "seasonal_naive":
        yw = _weeks(d.y, d.y.shape[0] // 7)
        ref = yw[np.arange(as_of_day, as_of_day + n_days) // 7 - 52]
        mean = ref / 7.0 * f.weekday[np.arange(as_of_day, as_of_day + n_days) % 7]
        return mean, np.ones_like(mean), np.ones_like(mean), np.zeros(d.n_pairs, dtype=bool), train_weeks
    steps = int(week.max()) + 1
    lev, intermittent = _levels(str(store.data_dir()), d.sid, train_weeks, _factor_weeks(d, train_weeks), steps)
    return lev[week] / 7.0 * fac, fest, weather, intermittent, train_weeks


# --------------------------------------------------------------------------- bands and backtest

@lru_cache(maxsize=4)
def _band_quantiles(data_dir: str, sid: str) -> dict[str, np.ndarray]:
    """{'full'|'seasonal_naive': [cat, horizon 1..4, (q10, q90)]} ratio quantiles from the backtest."""
    bt = _backtest_table(sid)
    d = _load(data_dir, sid)
    cat_of = dict(zip(d.sku, (d.cats[c] for c in d.cat_idx)))
    bt = bt.assign(cat=bt["sku_id"].map(cat_of))
    out = {}
    for mode, col in (("full", "p50"), ("seasonal_naive", "naive")):
        q = np.tile(np.array([0.75, 1.25]), (len(d.cats), BACKTEST_WEEKS, 1))
        ok = bt[bt[col] > 0]
        for (cat, h), g in ok.groupby(["cat", "horizon"]):
            r = g["actual"] / g[col]
            q[d.cats.index(cat), int(h) - 1] = np.quantile(r, [0.10, 0.90])
        out[mode] = q
    return out


def _backtest_table(sid: str) -> pd.DataFrame:
    if store.table_exists("backtest", sid):
        return store.read_table("backtest", sid)
    d = _data(sid)
    last = d.day(d.test_start) // 7 - BACKTEST_WEEKS
    origins = [last - BACKTEST_WEEKS * i for i in range(N_ORIGINS)][::-1]
    yw = _weeks(d.y, d.y.shape[0] // 7)
    rows = []
    for o in origins:
        mean, *_ = _daily_mean(d, o * 7, BACKTEST_WEEKS * 7, "full")
        p50 = _weeks(mean, BACKTEST_WEEKS)
        for h in range(BACKTEST_WEEKS):
            rows.append(pd.DataFrame({
                "origin": d.start + timedelta(weeks=o), "sku_id": d.sku, "dist_id": d.dist,
                "week_start": d.start + timedelta(weeks=o + h), "horizon": h + 1,
                "actual": yw[o + h], "p50": p50[h], "naive": yw[o + h - 52]}))
    bt = pd.concat(rows, ignore_index=True)
    cat_of = dict(zip(d.sku, (d.cats[c] for c in d.cat_idx)))
    bt["p10"], bt["p90"] = np.nan, np.nan
    tmp = bt.assign(cat=bt["sku_id"].map(cat_of))
    for (cat, h), g in tmp[tmp["p50"] > 0].groupby(["cat", "horizon"]):
        q10, q90 = np.quantile(g["actual"] / g["p50"], [0.10, 0.90])
        bt.loc[g.index, "p10"], bt.loc[g.index, "p90"] = g["p50"] * q10, g["p50"] * q90
    bt = bt[store.TABLES["backtest"][1]]
    store.write_table("backtest", bt, sid)
    return bt


def backtest(scenario_id: str) -> BacktestMetrics:
    """12 rolling-origin backtests (4-week horizon) on history; cached as store table 'backtest'."""
    bt = _backtest_table(scenario_id)
    d = _data(scenario_id)
    a = bt["actual"].sum()
    fest_any = np.zeros_like(d.y, dtype=bool)
    for m in d.fest.values():
        fest_any |= m
    fw = _weeks(fest_any, d.y.shape[0] // 7, "any")
    week_idx = ((pd.to_datetime(bt["week_start"]) - pd.Timestamp(d.start)).dt.days // 7).to_numpy()
    pair_idx = pd.Series(range(d.n_pairs), index=pd.MultiIndex.from_arrays([d.sku, d.dist]))
    pcol = pair_idx.loc[list(zip(bt["sku_id"], bt["dist_id"]))].to_numpy()
    fest = bt[fw[week_idx, pcol]]
    covered = (bt["actual"] >= bt["p10"]) & (bt["actual"] <= bt["p90"])
    return BacktestMetrics(
        wape=float((bt["actual"] - bt["p50"]).abs().sum() / a),
        wape_seasonal_naive=float((bt["actual"] - bt["naive"]).abs().sum() / a),
        bias=float((bt["p50"] - bt["actual"]).sum() / a),
        coverage_p10_p90=float(covered[bt["p10"].notna()].mean()),
        wape_festival_weeks=float((fest["actual"] - fest["p50"]).abs().sum() / max(fest["actual"].sum(), 1e-9)),
    )


# --------------------------------------------------------------------------- public

def forecast(scenario_id: str, as_of: date, horizon_days: int = 28, model: Mode = "full") -> ForecastBundle:
    """Daily mean/var per SKU x distributor for horizon_days from as_of, plus weekly P10/P50/P90 rows."""
    d = _data(scenario_id)
    as_of_day = d.day(as_of)
    if as_of_day < 7 * 60:
        raise ValueError("need at least 60 weeks of history before as_of")
    mean, fest, weather, intermittent, train_weeks = _daily_mean(d, as_of_day, horizon_days, model)

    q = _band_quantiles(str(store.data_dir()), scenario_id)[model]
    week = (np.arange(as_of_day, as_of_day + horizon_days) // 7) - train_weeks
    h = np.minimum(week, BACKTEST_WEEKS - 1)
    rel = (q[d.cat_idx[None, :], h[:, None], 1] - q[d.cat_idx[None, :], h[:, None], 0]) / (2 * Z90)
    week_total = pd.DataFrame(mean).groupby(week).transform("sum").to_numpy()
    var = np.maximum((rel * week_total) ** 2 * np.where(week_total > 0, mean / np.maximum(week_total, 1e-9), 0), 1e-9)

    if model == "seasonal_naive":
        kind = [ForecastModelKind.SEASONAL_NAIVE] * d.n_pairs
    else:
        kind = [ForecastModelKind.TSB if i else ForecastModelKind.AUTO_ETS for i in intermittent]
    pairs = [PairForecast(sku_id=d.sku[p], dist_id=d.dist[p], start=as_of, mean=mean[:, p].round(4).tolist(),
                          var=var[:, p].round(4).tolist(), festival=fest[:, p].round(4).tolist(),
                          weather=weather[:, p].round(4).tolist(), promo=[1.0] * horizon_days,
                          model=kind[p])
             for p in range(d.n_pairs)]

    weekly = []
    names = list(d.fest)
    for b in range(0, horizon_days, 7):
        sl = slice(b, min(b + 7, horizon_days))
        p50, sd = mean[sl].sum(0), np.sqrt(var[sl].sum(0))
        lo = as_of_day + b
        for p in range(d.n_pairs):
            factors = {n: round(float(fest[sl, p].max()), 2) for n in names
                       if d.fest[n][lo:lo + 7, p].any() and fest[sl, p].max() > 1.0}
            w = float(weather[sl, p].mean())
            if abs(w - 1) >= 0.05:
                factors["weather"] = round(w, 2)
            weekly.append(ForecastRow(sku_id=d.sku[p], dist_id=d.dist[p], week_start=as_of + timedelta(days=b),
                                      p10=float(max(0.0, p50[p] - Z90 * sd[p])), p50=float(p50[p]),
                                      p90=float(p50[p] + Z90 * sd[p]), model=kind[p].value, factors=factors))
    return ForecastBundle(scenario_id=scenario_id, as_of=as_of, horizon_days=horizon_days, pairs=pairs, weekly=weekly)
