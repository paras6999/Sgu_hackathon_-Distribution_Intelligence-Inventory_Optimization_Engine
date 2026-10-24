"""Engine storage (owner: M2). The ONLY engine module that reads or writes files.

The engine owns the parquet store (analytical, write-once). App state (plans, proposals, events,
experiment jobs) lives in the backend's SQLite and never touches the engine.

Table names and required columns below are part of the contract. write_table() rejects a DataFrame
whose columns differ, so a producer cannot silently break a consumer.
"""
from __future__ import annotations

import os
from pathlib import Path

import pandas as pd
from dia_types import ExperimentResults


def data_dir() -> Path:
    """$DIA_DATA_DIR, else <repo>/data/engine."""
    if env := os.environ.get("DIA_DATA_DIR"):
        return Path(env)
    for parent in Path(__file__).resolve().parents:
        if (parent / "packages" / "dia-config").is_dir():
            return parent / "data" / "engine"
    return Path.cwd() / "data" / "engine"


# scope "scenario": <data>/<scenario_id>/<name>.parquet
# scope "shared":   <data>/<name>.parquet
# scope "experiment": <data>/experiments/<experiment_id>/<name>.parquet
TABLES: dict[str, tuple[str, list[str]]] = {
    # producer: data/ (M4, backup M2)
    "nodes": ("scenario", ["node_id", "type", "city", "region", "lat", "lon", "storage_m3",
                           "credit_limit_inr", "mrsl_fraction", "home_depot_id"]),
    "skus": ("scenario", ["sku_id", "name", "category", "temp_class", "shelf_life_days", "kg_per_case",
                          "m3_per_case", "price_inr", "landed_cost_inr", "margin_inr", "disposal_inr"]),
    "lanes": ("scenario", ["from_id", "to_id", "km", "lead_days_mean", "p_delay", "ftl_cost_amb32_inr",
                           "ftl_cost_reef17_inr", "ptl_rate_inr_per_kg", "ptl_min_charge_inr",
                           "co2_kg_per_trip_amb32", "co2_kg_per_trip_reef17"]),
    "lots": ("scenario", ["lot_id", "sku_id", "depot_id", "qty_cases", "mfg_date", "expiry_date"]),
    "plant_receipts": ("scenario", ["date", "lot_id", "sku_id", "depot_id", "qty_cases", "mfg_date", "expiry_date"]),
    "demand_daily": ("scenario", ["date", "sku_id", "dist_id", "true_demand", "sold", "stockout_flag"]),
    "events": ("scenario", ["date", "region", "category", "event_type", "name", "factor"]),
    "weather_daily": ("shared", ["date", "city", "tmax_c", "precip_mm"]),
    # producer: forecast/ (M2)
    "forecast": ("scenario", ["as_of", "sku_id", "dist_id", "week_start", "p10", "p50", "p90", "model", "factors_json"]),
    "backtest": ("scenario", ["origin", "sku_id", "dist_id", "week_start", "horizon", "actual", "p10", "p50", "p90", "naive"]),
    "targets": ("scenario", ["as_of", "sku_id", "dist_id", "S", "critical_ratio", "z"]),
    # producer: sim/ (M1)
    "sim_log": ("experiment", ["seed", "policy", "opening_state", "date", "node_id", "sku_id", "opening",
                               "receipts", "sales", "lost", "expired", "credit_cut", "closing"]),
    "sim_trips": ("experiment", ["seed", "policy", "opening_state", "date", "truck_id", "mode", "from_id",
                                 "to_id", "kg_pct", "m3_pct", "cost_inr", "co2_kg"]),
    "kpi_results": ("experiment", ["policy", "opening_state", "seed", "kpi", "value"]),
}


def _table_path(name: str, key: str | None) -> Path:
    scope, _ = TABLES[name]
    if scope == "shared":
        return data_dir() / f"{name}.parquet"
    if key is None:
        raise ValueError(f"table {name!r} needs a {scope} id")
    if scope == "scenario":
        return data_dir() / key / f"{name}.parquet"
    return data_dir() / "experiments" / key / f"{name}.parquet"


def write_table(name: str, df: pd.DataFrame, key: str | None = None) -> Path:
    """Write a contract table. `key` = scenario_id or experiment_id (None for shared tables)."""
    if name not in TABLES:
        raise KeyError(f"unknown table {name!r}; add it to store.TABLES via a contract PR")
    expected = TABLES[name][1]
    if list(df.columns) != expected:
        missing = [c for c in expected if c not in df.columns]
        extra = [c for c in df.columns if c not in expected]
        raise ValueError(f"table {name!r}: columns must be {expected} in order; missing={missing} extra={extra}")
    path = _table_path(name, key)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False)
    return path


def read_table(name: str, key: str | None = None) -> pd.DataFrame:
    return pd.read_parquet(_table_path(name, key))


def table_exists(name: str, key: str | None = None) -> bool:
    return _table_path(name, key).exists()


def list_scenarios() -> list[str]:
    root = data_dir()
    if not root.is_dir():
        return []
    return sorted(p.name for p in root.iterdir() if (p / "nodes.parquet").exists())


def results_path(experiment_id: str) -> Path:
    """results.json read by the backend for GET /v1/experiments/{id}/results."""
    return data_dir() / "experiments" / experiment_id / "results.json"


def save_results(results: ExperimentResults) -> Path:
    path = results_path(results.experiment_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(results.model_dump_json(indent=2), encoding="utf-8")
    return path
