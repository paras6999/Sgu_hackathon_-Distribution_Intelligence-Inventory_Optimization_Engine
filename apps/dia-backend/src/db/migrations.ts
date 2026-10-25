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
  /* 002 warehouse app: sessions, stock movements, counted stock */ `
  CREATE TABLE wh_sessions (
    token       TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL,
    role        TEXT NOT NULL,
    node_id     TEXT,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL
  );
  CREATE TABLE stock_movements (
    movement_id INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id TEXT NOT NULL,
    as_of       TEXT NOT NULL,
    kind        TEXT NOT NULL,          -- receipt | count | adjust
    node_id     TEXT NOT NULL,
    sku_id      TEXT NOT NULL,
    sku_name    TEXT NOT NULL,
    cases       REAL NOT NULL,
    reason      TEXT,
    user_id     TEXT NOT NULL,
    ts          TEXT NOT NULL
  );
  CREATE INDEX ix_movements_node ON stock_movements(scenario_id, as_of, node_id);
  CREATE TABLE stock_counts (            -- counted quantity per day: counts set it, adjustments move it
    scenario_id TEXT NOT NULL,
    as_of       TEXT NOT NULL,
    node_id     TEXT NOT NULL,
    sku_id      TEXT NOT NULL,
    cases       REAL NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (scenario_id, as_of, node_id, sku_id)
  );`,
];
