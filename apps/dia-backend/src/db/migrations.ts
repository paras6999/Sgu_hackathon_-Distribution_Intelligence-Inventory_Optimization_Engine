/**
 * SQLite schema migrations (owner: M2). Append new entries; never edit a shipped one.
 * Kept as TS strings so `bun build --compile` embeds them in the binary.
 */
export const MIGRATIONS: string[] = [
  /* 001 init */ `
  CREATE TABLE plans (
    plan_id      TEXT NOT NULL,
    version      INTEGER NOT NULL,
    scenario_id  TEXT NOT NULL,
    as_of        TEXT NOT NULL,
    temp_class   TEXT NOT NULL,
    status       TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    payload      TEXT NOT NULL,          -- full Plan JSON: source of truth for lines and trucks
    PRIMARY KEY (plan_id, version)
  );
  CREATE TABLE proposals (
    plan_id          TEXT NOT NULL,
    dist_id          TEXT NOT NULL,
    proposal_version INTEGER NOT NULL,
    status           TEXT NOT NULL,
    sent_at          TEXT,
    responded_at     TEXT,
    PRIMARY KEY (plan_id, dist_id)
  );
  CREATE TABLE plan_events (
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
  CREATE INDEX ix_events_plan ON plan_events(plan_id);
  CREATE TABLE experiments (
    experiment_id TEXT PRIMARY KEY,
    config_hash   TEXT NOT NULL UNIQUE,
    status        TEXT NOT NULL,
    progress_pct  REAL NOT NULL DEFAULT 0,
    started_at    TEXT,
    finished_at   TEXT,
    error         TEXT
  );`,
];
