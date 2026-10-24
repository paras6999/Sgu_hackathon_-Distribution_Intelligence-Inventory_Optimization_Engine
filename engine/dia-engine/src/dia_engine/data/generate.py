"""FR-01 Scenario generator v0 (owner: M4, backup M2).

Writes the scenario tables in store.TABLES for one seed. Every number traces to config.yaml
(docs/Rules.md, "Simulated data must be realistic"):

  daily demand = base x volume_scale x size(city) x weekday x season(category, month) x growth
                 x festival(region, category) x heat x rain x unannounced promo x regional shock
  true_demand  ~ NegativeBinomial(mean, dispersion k)

demand_daily covers history AND the test window. History rows carry censored sales on stockout
days; test-window rows have sold = true_demand and no flag (the simulator decides). The forecaster
must only read rows with date < as_of. Unannounced promos and the regional shock are NOT written to
`events`, so the forecaster cannot see them (PRD FR-01).
"""
from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np
import pandas as pd

from dia_engine import store
from dia_engine.config import Config
from dia_engine.data.weather import load_weather
from dia_types import Lane, Node, NodeType, Scenario, Sku, TempClass, TruckClass

TRUCK_COLS = {TruckClass.AMB32: "amb32", TruckClass.REEF17: "reef17"}


def scenario_id_for(seed: int) -> str:
    return f"seed{seed:02d}"


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def ftl_trip_cost(cfg: Config, truck: str, km: float) -> float:
    """A11/A12: max(min, fixed + km x (diesel / km_per_l + non-fuel per km)), before festival premium."""
    t = cfg.costs.ftl[truck]
    return max(t.min_inr, t.fixed_inr + km * (cfg.costs.diesel_inr_per_l / t.km_per_l + t.non_fuel_per_km_inr))


def _sku_table(cfg: Config) -> pd.DataFrame:
    rows = []
    for s in cfg.catalogue.skus:
        c = cfg.categories[s.category]
        price = s.mrp_inr * s.units_per_case * c.realisation
        landed = price * (1 - c.gross_margin)
        rows.append([s.id, s.name, s.category, s.temp_class, s.shelf_life_days, s.kg_per_case, s.m3_per_case,
                     round(price, 2), round(landed, 2), round(price - landed, 2), c.disposal_inr_per_case])
    return pd.DataFrame(rows, columns=store.TABLES["skus"][1])


def _size_factors(cfg: Config) -> np.ndarray:
    sf = cfg.catalogue.size_factor
    pops = np.array([d.population_m for d in cfg.catalogue.distributors])
    return np.clip((pops / sf.reference_population_m) ** sf.exponent, sf.min, sf.max)


def _base_daily(cfg: Config) -> np.ndarray:
    """[sku, dist] neutral-month mean cases/day."""
    base = np.array([s.base_cases_per_day for s in cfg.catalogue.skus]) * cfg.demand.volume_scale
    return base[:, None] * _size_factors(cfg)[None, :]


def _node_table(cfg: Config, skus: pd.DataFrame) -> pd.DataFrame:
    base = _base_daily(cfg)
    weekly_m3 = (base * skus["m3_per_case"].to_numpy()[:, None]).sum(axis=0) * 7
    weekly_inr = (base * skus["price_inr"].to_numpy()[:, None]).sum(axis=0) * 7
    home = {d.region: d.id for d in cfg.catalogue.depots}
    rows = [[d.id, NodeType.DEPOT.value, d.city, d.region, d.lat, d.lon, None, None, None, None]
            for d in cfg.catalogue.depots]
    for j, d in enumerate(cfg.catalogue.distributors):
        rows.append([d.id, NodeType.DISTRIBUTOR.value, d.city, d.region, d.lat, d.lon,
                     round(weekly_m3[j] * cfg.supply.distributor_storage_weeks, 1),
                     round(weekly_inr[j] * cfg.supply.distributor_credit_weeks, -3),
                     cfg.planning.mrsl_fraction["GT"], home[d.region]])
    return pd.DataFrame(rows, columns=store.TABLES["nodes"][1])


def _lane_table(cfg: Config) -> pd.DataFrame:
    rows = []
    for w in cfg.catalogue.depots:
        for d in cfg.catalogue.distributors:
            km = round(_haversine_km(w.lat, w.lon, d.lat, d.lon) * cfg.network.road_factor, 1)
            intra = w.region == d.region
            lead = (1 if km <= 300 else 2) if intra else (3 if km <= 1200 else 4 if km <= 2000 else 5)
            p_delay = cfg.simulation.delay_prob["intra" if intra else "inter"]
            override = cfg.costs.lane_rate_overrides.get(f"{w.id}-{d.id}")
            amb = override if override is not None else ftl_trip_cost(cfg, "AMB32", km)
            reef = ftl_trip_cost(cfg, "REEF17", km)
            ptl = next(rate for max_km, rate in cfg.costs.ptl.slabs if km <= max_km)
            co2 = {k: km / cfg.costs.ftl[k].km_per_l * cfg.carbon.diesel_kg_co2_per_l for k in ("AMB32", "REEF17")}
            rows.append([w.id, d.id, km, lead, p_delay, round(amb, 2), round(reef, 2), ptl,
                         cfg.costs.ptl.min_charge_inr, round(co2["AMB32"], 1), round(co2["REEF17"], 1)])
    return pd.DataFrame(rows, columns=store.TABLES["lanes"][1])


def _festival_factors(cfg: Config, dates: pd.DatetimeIndex) -> tuple[np.ndarray, pd.DataFrame]:
    """[day, sku, dist] multiplicative festival factor, plus the `events` rows (festivals only)."""
    regions = np.array([d.region for d in cfg.catalogue.distributors])
    cats = [s.category for s in cfg.catalogue.skus]
    idx = {d: i for i, d in enumerate(dates.date)}
    fac = np.ones((len(dates), len(cats), len(regions)))
    events = []
    for f in cfg.calendar.festivals:
        for day in f.dates:
            for k in range(f.days_before + 1):
                dt = day - timedelta(days=f.days_before - k)
                if dt not in idx:
                    continue
                for cat, up in f.uplift.items():
                    for region in f.regions:
                        events.append([dt, region, cat, "festival", f.name, up])
                        s_mask = np.array([c == cat for c in cats])
                        fac[idx[dt]][np.ix_(s_mask, regions == region)] *= up
    ev = pd.DataFrame(events, columns=store.TABLES["events"][1]).sort_values(["date", "region", "category"])
    return fac, ev.reset_index(drop=True)


def _expected_demand(cfg: Config, dates: pd.DatetimeIndex, rng: np.random.Generator,
                     weather: pd.DataFrame) -> tuple[np.ndarray, pd.DataFrame]:
    skus, dists = cfg.catalogue.skus, cfg.catalogue.distributors
    cats = [cfg.categories[s.category] for s in skus]
    n_d, n_s, n_j = len(dates), len(skus), len(dists)
    mean = np.broadcast_to(_base_daily(cfg), (n_d, n_s, n_j)).copy()

    mean *= np.asarray(cfg.demand.weekday_profile)[dates.day_of_week.to_numpy()][:, None, None]
    season = np.array([c.season for c in cats])                      # [sku, 12]
    mean *= season[:, dates.month.to_numpy() - 1].T[:, :, None]
    years = (dates - dates[0]).days.to_numpy() / 365.0
    mean *= ((1 + cfg.demand.annual_growth) ** years)[:, None, None]

    fest, events = _festival_factors(cfg, dates)
    mean *= fest

    w = weather.assign(date=pd.to_datetime(weather["date"])).pivot(index="date", columns="city")
    tmax = w["tmax_c"].reindex(dates)[[d.city for d in dists]].to_numpy()      # [day, dist]
    rain = w["precip_mm"].reindex(dates)[[d.city for d in dists]].to_numpy()
    beta = np.array([c.heat_beta for c in cats])
    cut = np.array([c.rain_cut for c in cats])
    mean *= 1 + beta[None, :, None] * np.maximum(0.0, tmax - 32.0)[:, None, :]
    mean *= np.where((rain > 20.0)[:, None, :], 1 - cut[None, :, None], 1.0)

    # Unannounced promos: per SKU x region x week, uplift for 7 days then a 7-day dip. Not in `events`.
    pr = cfg.demand.unannounced_promo
    regions = np.array([d.region for d in dists])
    week = (dates - dates[0]).days.to_numpy() // 7
    for region in "NSEW":
        cols = regions == region
        for s in range(n_s):
            hits = np.flatnonzero(rng.random(week.max() + 1) < pr.weekly_prob)
            for h in hits:
                mean[np.ix_(week == h, [s], cols)] *= pr.uplift
                mean[np.ix_(week == h + 1, [s], cols)] *= pr.post_dip

    # One regional demand shock in the test window. Not in `events`.
    sh = cfg.demand.regional_shock
    days = (dates.date >= sh.start) & (dates.date < sh.start + timedelta(days=sh.days))
    s_mask = np.array([s.category == sh.category for s in skus])
    mean[np.ix_(days, s_mask, regions == sh.region)] *= sh.factor
    return mean, events


def _supply(cfg: Config, skus: pd.DataFrame, rng: np.random.Generator) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Opening depot lots on the first test day and fixed plant receipts through the test window."""
    t0, t1 = cfg.simulation.test_window
    base = _base_daily(cfg)
    regions = np.array([d.region for d in cfg.catalogue.distributors])
    sup = cfg.supply
    lots, receipts = [], []
    for w in cfg.catalogue.depots:
        regional = base[:, regions == w.region].sum(axis=1)                       # [sku] cases/day
        for s, sku in enumerate(cfg.catalogue.skus):
            code = f"{w.id.split('-')[0]}-{sku.id.replace('-', '')}"
            life = sku.shelf_life_days
            chilled = sku.temp_class == TempClass.CHILLED.value
            daily = regional[s] * cfg.categories[sku.category].season[t0.month - 1]
            opening = daily * sup.opening_cover_days[sku.temp_class]
            for n, (share, used) in enumerate([(0.6, (0.25, 0.40) if not chilled else (2, 3)),
                                               (0.4, sup.life_used_at_receipt.ambient if not chilled
                                                else sup.life_used_at_receipt.chilled_days)], start=1):
                used_days = (int(rng.integers(used[0], used[1] + 1)) if chilled
                             else int(rng.uniform(*used) * life))
                mfg = t0 - timedelta(days=used_days)
                lots.append([f"{code}-{n:04d}", sku.id, w.id, round(opening * share), mfg, mfg + timedelta(days=life)])
            every = sup.receipt_every_days[sku.temp_class]
            n = 100
            day = t0 + timedelta(days=every)
            while day <= t1:
                month_daily = regional[s] * cfg.categories[sku.category].season[day.month - 1]
                used_days = (int(rng.integers(sup.life_used_at_receipt.chilled_days[0],
                                              sup.life_used_at_receipt.chilled_days[1] + 1)) if chilled
                             else int(rng.uniform(*sup.life_used_at_receipt.ambient) * life))
                mfg = day - timedelta(days=used_days)
                receipts.append([day, f"{code}-{n:04d}", sku.id, w.id,
                                 round(month_daily * every * sup.plant_output_x_base_demand),
                                 mfg, mfg + timedelta(days=life)])
                n += 1
                day += timedelta(days=every)
    return (pd.DataFrame(lots, columns=store.TABLES["lots"][1]),
            pd.DataFrame(receipts, columns=store.TABLES["plant_receipts"][1]))


def generate(cfg: Config, seed: int) -> str:
    """Build and persist one scenario. Same cfg + seed gives identical tables. Returns scenario_id."""
    sid = scenario_id_for(seed)
    rng = np.random.default_rng(seed)
    start, end = cfg.simulation.history[0], cfg.simulation.test_window[1]
    dates = pd.date_range(start, end, freq="D")

    skus = _sku_table(cfg)
    weather = load_weather(cfg, start, end)
    mean, events = _expected_demand(cfg, dates, rng, weather)

    k = cfg.demand.nb_dispersion_k
    true = rng.negative_binomial(k, k / (k + np.maximum(mean, 1e-9)))
    test_start = np.datetime64(cfg.simulation.test_window[0])
    history = (dates.to_numpy() < test_start)[:, None, None]
    stockout = history & (true > 0) & (rng.random(true.shape) < cfg.demand.history_stockout_prob)
    sold = np.where(stockout, rng.binomial(true, rng.uniform(0.3, 0.8, true.shape)), true)

    n_d, n_s, n_j = true.shape
    demand = pd.DataFrame({
        "date": np.repeat(dates.date, n_s * n_j),
        "sku_id": np.tile(np.repeat([s.id for s in cfg.catalogue.skus], n_j), n_d),
        "dist_id": np.tile([d.id for d in cfg.catalogue.distributors], n_d * n_s),
        "true_demand": true.reshape(-1).astype("int32"),
        "sold": sold.reshape(-1).astype("int32"),
        "stockout_flag": stockout.reshape(-1),
    })
    lots, receipts = _supply(cfg, skus, rng)

    store.write_table("nodes", _node_table(cfg, skus), sid)
    store.write_table("skus", skus, sid)
    store.write_table("lanes", _lane_table(cfg), sid)
    store.write_table("lots", lots, sid)
    store.write_table("plant_receipts", receipts, sid)
    store.write_table("demand_daily", demand, sid)
    store.write_table("events", events, sid)
    return sid


def load_scenario(scenario_id: str) -> Scenario:
    """Read nodes, skus and lanes from parquet into the Scenario contract."""
    nodes = store.read_table("nodes", scenario_id).astype(object)
    nodes = nodes.where(pd.notna(nodes), None)
    skus = store.read_table("skus", scenario_id)
    lanes = store.read_table("lanes", scenario_id)
    return Scenario(
        scenario_id=scenario_id, seed=int(scenario_id.removeprefix("seed")),
        nodes=[Node(**r) for r in nodes.to_dict("records")],
        skus=[Sku(**r) for r in skus.to_dict("records")],
        lanes=[Lane(from_id=r["from_id"], to_id=r["to_id"], km=r["km"], lead_days_mean=r["lead_days_mean"],
                    p_delay=r["p_delay"], ptl_rate_inr_per_kg=r["ptl_rate_inr_per_kg"],
                    ptl_min_charge_inr=r["ptl_min_charge_inr"],
                    ftl_cost_inr={t.value: r[f"ftl_cost_{c}_inr"] for t, c in TRUCK_COLS.items()},
                    co2_kg_per_trip={t.value: r[f"co2_kg_per_trip_{c}"] for t, c in TRUCK_COLS.items()})
               for r in lanes.to_dict("records")],
    )


def list_scenarios() -> list[str]:
    return store.list_scenarios()


def summary(scenario_id: str) -> dict[str, float]:
    """Headline realism statistics (checked by tests/test_realism.py, printed by `dia-engine generate`)."""
    d = store.read_table("demand_daily", scenario_id)
    skus = store.read_table("skus", scenario_id).set_index("sku_id")
    d["date"] = pd.to_datetime(d["date"])
    d["value"] = d["true_demand"] * d["sku_id"].map(skus["price_inr"])
    d["kg"] = d["true_demand"] * d["sku_id"].map(skus["kg_per_case"])
    d["cat"] = d["sku_id"].map(skus["category"])
    hist = d[d["date"] < pd.Timestamp("2025-09-29")]
    n_dist = d["dist_id"].nunique()
    snacks = d[d["cat"] == "snacks"].groupby("date")["true_demand"].sum()
    diwali = snacks["2025-10-10":"2025-10-20"].mean()
    before = snacks["2025-09-08":"2025-09-21"].mean()
    bev = d[d["cat"] == "beverages"].groupby(d["date"].dt.month)["true_demand"].mean()
    amb = d[d["sku_id"].map(skus["temp_class"]) == "ambient"]
    return {
        "revenue_per_distributor_cr_per_year": hist["value"].sum() / n_dist / (len(hist["date"].unique()) / 365) / 1e7,
        "diwali_snacks_uplift": diwali / before,
        "beverage_may_vs_dec": bev[5] / bev[12],
        "history_stockout_rate": hist["stockout_flag"].mean(),
        "ambient_tonnes_per_distributor_week": amb["kg"].sum() / n_dist / (len(d["date"].unique()) / 7) / 1000,
        "sunday_vs_monday": d[d["date"].dt.day_of_week == 6]["true_demand"].mean() / d[d["date"].dt.day_of_week == 0]["true_demand"].mean(),
    }
