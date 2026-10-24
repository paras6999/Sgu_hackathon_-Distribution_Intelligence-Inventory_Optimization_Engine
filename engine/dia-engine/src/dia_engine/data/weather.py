"""FR-02 Weather (owner: M4, backup M2).

Real history comes from the Open-Meteo archive API (fetch once, cached as the shared 'weather_daily'
table; never called during experiments or the demo). Until it is fetched, a synthetic series built
from packages/dia-config/climate.yaml stands in, so the generator always works offline.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from datetime import date

import numpy as np
import pandas as pd

from dia_engine import store
from dia_engine.config import Config, load_climate

OPEN_METEO_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"
WEATHER_SEED = 20251020  # weather is shared "real-world" data: same for every scenario seed


def fetch_weather(cfg: Config, start: date, end: date) -> pd.DataFrame:
    """Download daily max temperature and precipitation for every distributor city and cache it."""
    frames = []
    for d in cfg.catalogue.distributors:
        q = urllib.parse.urlencode({
            "latitude": d.lat, "longitude": d.lon, "start_date": start.isoformat(), "end_date": end.isoformat(),
            "daily": "temperature_2m_max,precipitation_sum", "timezone": "Asia/Kolkata",
        })
        with urllib.request.urlopen(f"{OPEN_METEO_ARCHIVE}?{q}", timeout=60) as r:
            daily = json.load(r)["daily"]
        frames.append(pd.DataFrame({"date": pd.to_datetime(daily["time"]).date, "city": d.city,
                                    "tmax_c": daily["temperature_2m_max"], "precip_mm": daily["precipitation_sum"]}))
    df = pd.concat(frames, ignore_index=True)
    df[["tmax_c", "precip_mm"]] = df[["tmax_c", "precip_mm"]].astype(float).fillna(0.0)
    store.write_table("weather_daily", df)
    return df


def synthetic_weather(cfg: Config, start: date, end: date) -> pd.DataFrame:
    """Climatology + AR(1) temperature noise + Bernoulli heavy-rain days (offline fallback)."""
    climate = load_climate()
    rng = np.random.default_rng(WEATHER_SEED)
    dates = pd.date_range(start, end, freq="D")
    month = dates.month.to_numpy() - 1
    days_in_month = dates.days_in_month.to_numpy()
    frames = []
    for d in cfg.catalogue.distributors:
        c = climate.cities[d.city]
        normal = np.asarray(c.tmax_c)[month]
        noise = np.zeros(len(dates))
        for i in range(1, len(dates)):
            noise[i] = 0.7 * noise[i - 1] + rng.normal(0, 1.4)
        p_heavy = np.asarray(c.heavy_rain_days)[month] / days_in_month
        heavy = rng.random(len(dates)) < p_heavy
        wet_season = np.asarray(c.heavy_rain_days)[month] > 0
        light = wet_season & ~heavy & (rng.random(len(dates)) < 0.35)
        precip = np.where(heavy, 20 + rng.exponential(18, len(dates)), np.where(light, rng.uniform(0.5, 8, len(dates)), 0.0))
        tmax = normal + noise - np.where(heavy, 2.0, 0.0)
        frames.append(pd.DataFrame({"date": dates.date, "city": d.city, "tmax_c": tmax.round(1),
                                    "precip_mm": precip.round(1)}))
    return pd.concat(frames, ignore_index=True)


def load_weather(cfg: Config, start: date, end: date) -> pd.DataFrame:
    """Cached real weather if it covers the range, else the synthetic fallback (cached too)."""
    if store.table_exists("weather_daily"):
        df = store.read_table("weather_daily")
        if df["date"].min() <= start and df["date"].max() >= end:
            return df
    df = synthetic_weather(cfg, start, end)
    store.write_table("weather_daily", df)
    return df
