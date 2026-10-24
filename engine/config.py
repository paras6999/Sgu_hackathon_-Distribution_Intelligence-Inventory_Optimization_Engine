"""Config loader and schema (owner: Member A). FR-01 acceptance: invalid config fails with the field name."""
from __future__ import annotations

import hashlib
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, ConfigDict

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config" / "config.yaml"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Network(_Strict):
    depots: list[str]
    distributors_per_region: int
    road_factor: float
    candidate_depots_per_distributor: int


class FestivalPrebuild(_Strict):
    lookahead_days: dict[str, int]
    min_factor: float


class Planning(_Strict):
    cadence_days: dict[str, int]
    mrsl_fraction: dict[str, float]
    fair_share_alpha: float
    critical_ratio_clip: tuple[float, float]
    festival_prebuild: FestivalPrebuild
    lost_sales_breakpoints: list[float]
    waste_breakpoints: list[float]


class WeatherNoise(_Strict):
    tmax_sd_c: float
    rain_rel: float


class Forecast(_Strict):
    param_refit_weeks: int
    weather_forecast_days: int
    weather_noise: WeatherNoise


class FtlClass(_Strict):
    min_inr: float
    fixed_inr: float
    non_fuel_per_km_inr: float
    km_per_l: float
    kg: float
    m3: float


class Ptl(_Strict):
    slabs: list[tuple[float, float]]
    min_charge_inr: float
    kg_per_m3: float
    fuel_share: float


class FestivalPremium(_Strict):
    months: list[int]
    factor: float


class Costs(_Strict):
    diesel_inr_per_l: float
    ftl: dict[str, FtlClass]
    lane_rate_overrides: dict[str, float]
    ptl: Ptl
    festival_freight_premium: FestivalPremium
    stockout_penalty_x_margin: float
    holding_rate_annual: float
    expiry_claim_share: float


class Carbon(_Strict):
    diesel_kg_co2_per_l: float
    ptl_load_factor: float
    price_inr_per_kg: float


class Simulation(_Strict):
    history: tuple[str, str]
    test_window: tuple[str, str]
    seeds: int
    delay_prob: dict[str, float]
    payment_lag_days: int


class Assumption(_Strict):
    unit: str | None = None
    source: str
    rationale: str | None = None


class Config(_Strict):
    network: Network
    planning: Planning
    forecast: Forecast
    costs: Costs
    carbon: Carbon
    simulation: Simulation
    assumptions: dict[str, Assumption] = {}


def load_config(path: Path | str = CONFIG_PATH) -> Config:
    with open(path, encoding="utf-8") as f:
        raw: dict[str, Any] = yaml.safe_load(f)
    return Config.model_validate(raw)


@lru_cache(maxsize=1)
def get_config() -> Config:
    return load_config()


def config_hash(cfg: Config | None = None) -> str:
    cfg = cfg or get_config()
    return hashlib.sha256(cfg.model_dump_json().encode()).hexdigest()[:12]
