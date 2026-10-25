"""Config loader and schema (owner: M2 schema, M4 values). FR-01: invalid config fails with the field name.

Config files live in packages/dia-config. Lookup order: $DIA_CONFIG_DIR, then the repo copy found by
walking up from this file, then the copy bundled into the binary (PyInstaller sys._MEIPASS/dia-config).
"""
from __future__ import annotations

import hashlib
import os
import sys
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field

Region = Literal["N", "S", "E", "W"]


def config_dir() -> Path:
    if env := os.environ.get("DIA_CONFIG_DIR"):
        return Path(env)
    for parent in Path(__file__).resolve().parents:
        candidate = parent / "packages" / "dia-config"
        if candidate.is_dir():
            return candidate
    bundled = Path(getattr(sys, "_MEIPASS", "")) / "dia-config"
    if bundled.is_dir():
        return bundled
    raise FileNotFoundError("packages/dia-config not found; set DIA_CONFIG_DIR")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- catalogue

class DepotDef(_Strict):
    id: str
    city: str
    region: Region
    lat: float
    lon: float


class DistributorDef(DepotDef):
    population_m: float


class SizeFactor(_Strict):
    reference_population_m: float
    exponent: float
    min: float
    max: float


class SkuDef(_Strict):
    id: str
    name: str
    category: str
    temp_class: Literal["ambient", "chilled"]
    shelf_life_days: int = Field(gt=0)
    units_per_case: int = Field(gt=0)
    mrp_inr: float = Field(gt=0)
    kg_per_case: float = Field(gt=0)
    m3_per_case: float = Field(gt=0)
    base_cases_per_day: float = Field(gt=0)


class Catalogue(_Strict):
    depots: list[DepotDef]
    distributors: list[DistributorDef]
    size_factor: SizeFactor
    skus: list[SkuDef]


class Category(_Strict):
    realisation: float = Field(gt=0, le=1)
    gross_margin: float = Field(gt=0, lt=1)
    disposal_inr_per_case: float = Field(ge=0)
    heat_beta: float = Field(ge=0)
    rain_cut: float = Field(ge=0, lt=1)
    season: list[float] = Field(min_length=12, max_length=12)


class Promo(_Strict):
    weekly_prob: float
    uplift: float
    post_dip: float


class Shock(_Strict):
    region: Region
    category: str
    start: date
    days: int
    factor: float


class Demand(_Strict):
    volume_scale: float = Field(gt=0)
    weekday_profile: list[float] = Field(min_length=7, max_length=7)
    annual_growth: float
    nb_dispersion_k: float = Field(gt=0)
    history_stockout_prob: float = Field(ge=0, lt=1)
    unannounced_promo: Promo
    regional_shock: Shock


class Festival(_Strict):
    name: str
    dates: list[date]
    regions: list[Region]
    days_before: int = Field(ge=0)
    uplift: dict[str, float]


class Calendar(_Strict):
    festivals: list[Festival]


class LifeUsed(_Strict):
    ambient: tuple[float, float]
    chilled_days: tuple[int, int]


class Supply(_Strict):
    plant_output_x_base_demand: float
    receipt_every_days: dict[Literal["ambient", "chilled"], int]
    life_used_at_receipt: LifeUsed
    opening_cover_days: dict[Literal["ambient", "chilled"], int]
    distributor_storage_weeks: float
    depot_storage_weeks: dict[Literal["ambient", "chilled"], float]
    distributor_credit_weeks: float


# --------------------------------------------------------------------------- planning, costs, simulation

class Network(_Strict):
    road_factor: float
    candidate_depots_per_distributor: int
    alt_depot_max_km: float
    chilled_max_km: float


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
    history: tuple[date, date]
    test_window: tuple[date, date]
    seeds: int
    delay_prob: dict[str, float]
    payment_lag_days: int


class Assumption(_Strict):
    unit: str | None = None
    source: str
    rationale: str | None = None


class Config(_Strict):
    network: Network
    catalogue: Catalogue
    categories: dict[str, Category]
    demand: Demand
    calendar: Calendar
    supply: Supply
    planning: Planning
    forecast: Forecast
    costs: Costs
    carbon: Carbon
    simulation: Simulation
    assumptions: dict[str, Assumption] = {}


class CityClimate(_Strict):
    tmax_c: list[float] = Field(min_length=12, max_length=12)
    heavy_rain_days: list[float] = Field(min_length=12, max_length=12)


class Climate(_Strict):
    cities: dict[str, CityClimate]


def load_config(path: Path | str | None = None) -> Config:
    with open(path or config_dir() / "config.yaml", encoding="utf-8") as f:
        cfg = Config.model_validate(yaml.safe_load(f))
    unknown = {s.category for s in cfg.catalogue.skus} - set(cfg.categories)
    if unknown:
        raise ValueError(f"catalogue.skus: unknown categories {sorted(unknown)}")
    return cfg


def load_climate(path: Path | str | None = None) -> Climate:
    with open(path or config_dir() / "climate.yaml", encoding="utf-8") as f:
        return Climate.model_validate(yaml.safe_load(f))


@lru_cache(maxsize=1)
def get_config() -> Config:
    return load_config()


def config_hash(cfg: Config | None = None) -> str:
    cfg = cfg or get_config()
    return hashlib.sha256(cfg.model_dump_json().encode()).hexdigest()[:12]
