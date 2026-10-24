/**
 * App-state repository (owner: M2). The ONLY code that touches SQLite (bun:sqlite, WAL).
 * Plans are immutable per version; proposals carry per-distributor optimistic versions (HTTP 409).
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ExperimentInfo, ExperimentStatus, Plan, PlanEvent, Proposal, ProposalStatus,
} from "@dia/types";
import { MIGRATIONS } from "./migrations";

export class Repo {
  readonly db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;");
    this.migrate();
  }

  private migrate(): void {
    const current = (this.db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    for (let i = current; i < MIGRATIONS.length; i++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[i]!);
        this.db.exec(`PRAGMA user_version = ${i + 1}`);
      })();
    }
  }

  tx<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }

  // ------------------------------------------------------------------ plans
  savePlan(p: Plan): void {
    this.db.query(
      `INSERT INTO plans (plan_id, version, scenario_id, as_of, temp_class, status, created_at, payload)
       VALUES ($plan_id, $version, $scenario_id, $as_of, $temp_class, $status, $created_at, $payload)
       ON CONFLICT(plan_id, version) DO UPDATE SET status = excluded.status, payload = excluded.payload`,
    ).run({
      plan_id: p.plan_id, version: p.version, scenario_id: p.scenario_id, as_of: p.as_of,
      temp_class: p.temp_class, status: p.status ?? "DRAFT", created_at: p.created_at, payload: JSON.stringify(p),
    });
  }

  loadPlan(planId: string, version?: number): Plan | null {
    const row = (version === undefined
      ? this.db.query("SELECT payload FROM plans WHERE plan_id = ? ORDER BY version DESC LIMIT 1").get(planId)
      : this.db.query("SELECT payload FROM plans WHERE plan_id = ? AND version = ?").get(planId, version)) as
      | { payload: string }
      | null;
    return row ? (JSON.parse(row.payload) as Plan) : null;
  }

  // ------------------------------------------------------------------ proposals
  upsertProposal(p: Proposal): void {
    this.db.query(
      `INSERT INTO proposals (plan_id, dist_id, proposal_version, status, sent_at, responded_at)
       VALUES ($plan_id, $dist_id, $proposal_version, $status, $sent_at, $responded_at)
       ON CONFLICT(plan_id, dist_id) DO UPDATE SET proposal_version = excluded.proposal_version,
         status = excluded.status, sent_at = excluded.sent_at, responded_at = excluded.responded_at`,
    ).run({
      plan_id: p.plan_id, dist_id: p.dist_id, proposal_version: p.proposal_version, status: p.status,
      sent_at: p.sent_at ?? null, responded_at: p.responded_at ?? null,
    });
  }

  getProposals(planId: string): Proposal[] {
    const rows = this.db.query("SELECT * FROM proposals WHERE plan_id = ? ORDER BY dist_id").all(planId) as Array<
      Record<string, unknown>
    >;
    return rows.map((r) => ({
      plan_id: r.plan_id as string,
      dist_id: r.dist_id as string,
      proposal_version: r.proposal_version as number,
      status: r.status as ProposalStatus,
      sent_at: (r.sent_at as string | null) ?? null,
      responded_at: (r.responded_at as string | null) ?? null,
    }));
  }

  // ------------------------------------------------------------------ events
  logEvent(e: PlanEvent): void {
    this.db.query(
      `INSERT INTO plan_events (plan_id, plan_version, dist_id, actor, action, line_id, old_qty, new_qty, delta_cost_inr, ts)
       VALUES ($plan_id, $plan_version, $dist_id, $actor, $action, $line_id, $old_qty, $new_qty, $delta_cost_inr, $ts)`,
    ).run({
      plan_id: e.plan_id, plan_version: e.plan_version, dist_id: e.dist_id ?? null, actor: e.actor, action: e.action,
      line_id: e.line_id ?? null, old_qty: e.old_qty ?? null, new_qty: e.new_qty ?? null,
      delta_cost_inr: e.delta_cost_inr ?? 0, ts: e.ts,
    });
  }

  listEvents(planId: string): PlanEvent[] {
    const rows = this.db.query("SELECT * FROM plan_events WHERE plan_id = ? ORDER BY event_id").all(planId) as Array<
      Record<string, unknown> & { event_id?: number }
    >;
    return rows.map(({ event_id: _, ...r }) => r as unknown as PlanEvent);
  }

  // ------------------------------------------------------------------ experiments
  /** Returns [experimentId, alreadyExists]. Identical config hashes reuse the cached run unless it failed. */
  createExperiment(configHash: string): [string, boolean] {
    return this.tx(() => {
      const row = this.db.query("SELECT experiment_id, status FROM experiments WHERE config_hash = ?").get(configHash) as
        | { experiment_id: string; status: string }
        | null;
      if (row && row.status !== "failed") return [row.experiment_id, true];
      const id = `EX-${configHash}`;
      this.db.query(
        `INSERT OR REPLACE INTO experiments (experiment_id, config_hash, status, progress_pct, started_at)
         VALUES (?, ?, 'queued', 0, ?)`,
      ).run(id, configHash, new Date().toISOString());
      return [id, false];
    });
  }

  updateExperiment(id: string, status: ExperimentStatus, progress: number, error: string | null = null): void {
    const finished = status === "done" || status === "failed" ? new Date().toISOString() : null;
    this.db.query(
      `UPDATE experiments SET status = ?, progress_pct = ?, error = ?, finished_at = COALESCE(?, finished_at)
       WHERE experiment_id = ?`,
    ).run(status, progress, error, finished, id);
  }

  getExperiment(id: string): ExperimentInfo | null {
    const r = this.db.query("SELECT * FROM experiments WHERE experiment_id = ?").get(id) as Record<string, unknown> | null;
    if (!r) return null;
    return {
      experiment_id: r.experiment_id as string,
      status: r.status as ExperimentStatus,
      progress_pct: r.progress_pct as number,
      config_hash: r.config_hash as string,
      error: (r.error as string | null) ?? null,
    };
  }
}
