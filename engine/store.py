"""Storage layer (owner: Member D). The ONLY module that touches files or the database.

Two stores (see Architecture.md, "Database"):
  * Parquet  - bulk, write-once analytical tables (scenario data, forecasts, simulation logs, KPIs).
  * SQLite   - small transactional app state (plans, proposals, plan events, experiment jobs).

Table names and required columns below are part of the contract. write_table() rejects a
DataFrame whose columns do not match, so a producer cannot silently break a consumer.
"""
from __future__ import annotations

import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

import pandas as pd

from engine.models import (
    ExperimentInfo, ExperimentResults, ExperimentStatus, Plan, PlanEvent, Proposal, ProposalStatus,
)

DATA_DIR = Path(os.environ.get("VITARAN_DATA", Path(__file__).resolve().parent.parent / "data"))

# --------------------------------------------------------------------------- parquet tables

# scope "scenario": data/<scenario_id>/<name>.parquet
# scope "shared":   data/<name>.parquet
# scope "experiment": data/experiments/<experiment_id>/<name>.parquet
TABLES: dict[str, tuple[str, list[str]]] = {
    # producer: Member A (generate.py, weather.py)
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
    # producer: Member B (forecast.py, targets.py)
    "forecast": ("scenario", ["as_of", "sku_id", "dist_id", "week_start", "p10", "p50", "p90", "model", "factors_json"]),
    "backtest": ("scenario", ["origin", "sku_id", "dist_id", "week_start", "horizon", "actual", "p10", "p50", "p90", "naive"]),
    "targets": ("scenario", ["as_of", "sku_id", "dist_id", "S", "critical_ratio", "z"]),
    # producer: Member A (simulate.py, kpi.py)
    "sim_log": ("experiment", ["seed", "policy", "opening_state", "date", "node_id", "sku_id", "opening",
                               "receipts", "sales", "lost", "expired", "credit_cut", "closing"]),
    "sim_trips": ("experiment", ["seed", "policy", "opening_state", "date", "truck_id", "mode", "from_id",
                                 "to_id", "kg_pct", "m3_pct", "cost_inr", "co2_kg"]),
    "kpi_results": ("experiment", ["policy", "opening_state", "seed", "kpi", "value"]),
}


def _table_path(name: str, key: str | None) -> Path:
    scope, _ = TABLES[name]
    if scope == "shared":
        return DATA_DIR / f"{name}.parquet"
    if key is None:
        raise ValueError(f"table {name!r} needs a {scope} id")
    if scope == "scenario":
        return DATA_DIR / key / f"{name}.parquet"
    return DATA_DIR / "experiments" / key / f"{name}.parquet"


def write_table(name: str, df: pd.DataFrame, key: str | None = None) -> Path:
    """Write a contract table. `key` = scenario_id or experiment_id (None for shared tables)."""
    if name not in TABLES:
        raise KeyError(f"unknown table {name!r}; add it to store.TABLES via a contract-change PR")
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


# --------------------------------------------------------------------------- sqlite app state

DB_PATH = DATA_DIR / "vitaran.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS plans (
    plan_id      TEXT NOT NULL,
    version      INTEGER NOT NULL,
    scenario_id  TEXT NOT NULL,
    as_of        TEXT NOT NULL,
    temp_class   TEXT NOT NULL,
    status       TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    payload      TEXT NOT NULL,          -- full Plan JSON (source of truth for lines and trucks)
    PRIMARY KEY (plan_id, version)
);
CREATE TABLE IF NOT EXISTS proposals (
    plan_id          TEXT NOT NULL,
    dist_id          TEXT NOT NULL,
    proposal_version INTEGER NOT NULL,
    status           TEXT NOT NULL,
    sent_at          TEXT,
    responded_at     TEXT,
    PRIMARY KEY (plan_id, dist_id)
);
CREATE TABLE IF NOT EXISTS plan_events (
    event_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id        TEXT NOT NULL,
    plan_version   INTEGER NOT NULL,
    dist_id        TEXT,
    actor          TEXT NOT NULL,
    action         TEXT NOT NULL,
    line_id        TEXT,
    old_qty        REAL,
    new_qty        REAL,
    delta_cost_inr REAL NOT NULL DEFAULT 0,
    ts             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_events_plan ON plan_events(plan_id);
CREATE TABLE IF NOT EXISTS experiments (
    experiment_id TEXT PRIMARY KEY,
    config_hash   TEXT NOT NULL UNIQUE,
    status        TEXT NOT NULL,
    progress_pct  REAL NOT NULL DEFAULT 0,
    started_at    TEXT,
    finished_at   TEXT,
    error         TEXT
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(SCHEMA)
    return conn


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    """Serialised write transaction (BEGIN IMMEDIATE). Use for every read-modify-write."""
    conn = connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        yield conn
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


def new_plan_id() -> str:
    return "PL-" + uuid.uuid4().hex[:6].upper()


def save_plan(plan: Plan, conn: sqlite3.Connection | None = None) -> None:
    sql = ("INSERT INTO plans (plan_id, version, scenario_id, as_of, temp_class, status, created_at, payload) "
           "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(plan_id, version) DO UPDATE SET "
           "status=excluded.status, payload=excluded.payload")
    args = (plan.plan_id, plan.version, plan.scenario_id, plan.as_of.isoformat(), plan.temp_class.value,
            plan.status.value, plan.created_at.isoformat(), plan.model_dump_json())
    if conn is not None:
        conn.execute(sql, args)
        return
    with transaction() as c:
        c.execute(sql, args)


def load_plan(plan_id: str, version: int | None = None, conn: sqlite3.Connection | None = None) -> Plan | None:
    c = conn or connect()
    if version is None:
        row = c.execute("SELECT payload FROM plans WHERE plan_id=? ORDER BY version DESC LIMIT 1", (plan_id,)).fetchone()
    else:
        row = c.execute("SELECT payload FROM plans WHERE plan_id=? AND version=?", (plan_id, version)).fetchone()
    return Plan.model_validate_json(row["payload"]) if row else None


def upsert_proposal(p: Proposal, conn: sqlite3.Connection | None = None) -> None:
    sql = ("INSERT INTO proposals (plan_id, dist_id, proposal_version, status, sent_at, responded_at) "
           "VALUES (?,?,?,?,?,?) ON CONFLICT(plan_id, dist_id) DO UPDATE SET "
           "proposal_version=excluded.proposal_version, status=excluded.status, "
           "sent_at=excluded.sent_at, responded_at=excluded.responded_at")
    args = (p.plan_id, p.dist_id, p.proposal_version, p.status.value,
            p.sent_at.isoformat() if p.sent_at else None,
            p.responded_at.isoformat() if p.responded_at else None)
    if conn is not None:
        conn.execute(sql, args)
        return
    with transaction() as c:
        c.execute(sql, args)


def get_proposals(plan_id: str, conn: sqlite3.Connection | None = None) -> list[Proposal]:
    c = conn or connect()
    rows = c.execute("SELECT * FROM proposals WHERE plan_id=? ORDER BY dist_id", (plan_id,)).fetchall()
    return [Proposal(plan_id=r["plan_id"], dist_id=r["dist_id"], proposal_version=r["proposal_version"],
                     status=ProposalStatus(r["status"]), sent_at=r["sent_at"], responded_at=r["responded_at"])
            for r in rows]


def log_event(e: PlanEvent, conn: sqlite3.Connection | None = None) -> None:
    sql = ("INSERT INTO plan_events (plan_id, plan_version, dist_id, actor, action, line_id, old_qty, new_qty, "
           "delta_cost_inr, ts) VALUES (?,?,?,?,?,?,?,?,?,?)")
    args = (e.plan_id, e.plan_version, e.dist_id, e.actor, e.action, e.line_id, e.old_qty, e.new_qty,
            e.delta_cost_inr, e.ts.isoformat())
    if conn is not None:
        conn.execute(sql, args)
        return
    with transaction() as c:
        c.execute(sql, args)


def list_events(plan_id: str) -> list[PlanEvent]:
    rows = connect().execute("SELECT * FROM plan_events WHERE plan_id=? ORDER BY event_id", (plan_id,)).fetchall()
    return [PlanEvent(**{k: r[k] for k in r.keys() if k != "event_id"}) for r in rows]


def create_experiment(config_hash: str) -> tuple[str, bool]:
    """Return (experiment_id, already_exists). Identical config hashes reuse the cached run."""
    with transaction() as c:
        row = c.execute("SELECT experiment_id, status FROM experiments WHERE config_hash=?", (config_hash,)).fetchone()
        if row and row["status"] != ExperimentStatus.FAILED.value:
            return row["experiment_id"], True
        exp_id = "EX-" + config_hash
        c.execute("INSERT OR REPLACE INTO experiments (experiment_id, config_hash, status, progress_pct, started_at) "
                  "VALUES (?,?,?,0,?)", (exp_id, config_hash, ExperimentStatus.QUEUED.value, _now()))
        return exp_id, False


def update_experiment(experiment_id: str, status: ExperimentStatus, progress_pct: float,
                      error: str | None = None) -> None:
    finished = _now() if status in (ExperimentStatus.DONE, ExperimentStatus.FAILED) else None
    with transaction() as c:
        c.execute("UPDATE experiments SET status=?, progress_pct=?, error=?, finished_at=COALESCE(?, finished_at) "
                  "WHERE experiment_id=?", (status.value, progress_pct, error, finished, experiment_id))


def get_experiment(experiment_id: str) -> ExperimentInfo | None:
    r = connect().execute("SELECT * FROM experiments WHERE experiment_id=?", (experiment_id,)).fetchone()
    if not r:
        return None
    return ExperimentInfo(experiment_id=r["experiment_id"], status=ExperimentStatus(r["status"]),
                          progress_pct=r["progress_pct"], config_hash=r["config_hash"], error=r["error"])


def _results_path(experiment_id: str) -> Path:
    return DATA_DIR / "experiments" / experiment_id / "results.json"


def save_results(results: ExperimentResults) -> None:
    """Cached summary served by GET /v1/experiments/{id}/results (written by Member A's kpi.summarise)."""
    path = _results_path(results.experiment_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(results.model_dump_json(indent=2), encoding="utf-8")


def load_results(experiment_id: str) -> ExperimentResults | None:
    path = _results_path(experiment_id)
    return ExperimentResults.model_validate_json(path.read_text(encoding="utf-8")) if path.exists() else None
