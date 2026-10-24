/**
 * FakeEngine (owner: M2): every call answers from packages/dia-types/fixtures, so the backend and web
 * work before any engine code exists. resolve() applies actions directly (no re-solve, nothing grows).
 */
import type {
  AssumptionRow, BacktestMetrics, EnginePlanRequest, EngineResolveRequest, ExperimentResults, ForecastBundle,
  Plan, Scenario, Snapshot,
} from "@dia/types";
import assumptions from "@dia/types/fixtures/assumptions.json";
import backtest from "@dia/types/fixtures/backtest.json";
import forecast from "@dia/types/fixtures/forecast.json";
import plan from "@dia/types/fixtures/plan.json";
import results from "@dia/types/fixtures/results.json";
import scenario from "@dia/types/fixtures/scenario.json";
import snapshot from "@dia/types/fixtures/snapshot.json";
import type { EngineClient, ExperimentOutcome } from "./client";

const clone = <T>(x: unknown): T => structuredClone(x) as T;
const FIXTURE_PLAN_ID = (plan as Plan).plan_id;

export class FakeEngine implements EngineClient {
  readonly mode = "fake" as const;
  private results = new Map<string, ExperimentResults>();

  async health() { return { status: "ok", version: "fake", data_dir: "fixtures" }; }
  async scenarios() { return [(scenario as Scenario).scenario_id]; }
  async scenario() { return clone<Scenario>(scenario); }
  async snapshot() { return clone<Snapshot>(snapshot); }
  async forecast() { return clone<ForecastBundle>(forecast); }
  async backtest() { return clone<BacktestMetrics>(backtest); }
  async assumptions() { return clone<AssumptionRow[]>(assumptions); }

  async plan(req: EnginePlanRequest): Promise<Plan> {
    const text = JSON.stringify(plan)
      .replaceAll(`${FIXTURE_PLAN_ID}-v1-`, `${req.plan_id}-v${req.version ?? 1}-`)
      .replaceAll(`"${FIXTURE_PLAN_ID}"`, `"${req.plan_id}"`);
    const p = JSON.parse(text) as Plan;
    p.version = req.version ?? 1;
    if (req.settings) p.settings = req.settings;
    return p;
  }

  async resolve(req: EngineResolveRequest): Promise<Plan> {
    const next = clone<Plan>(req.plan);
    next.version = req.plan.version + 1;
    const acts = new Map(req.response.actions.map((a) => [a.line_id, a]));
    for (const line of next.lines) {
      const a = acts.get(line.line_id);
      if (!a) continue;
      if (a.action === "accept") line.status = "ACCEPTED";
      else if (a.action === "trim") { line.cases = a.qty ?? line.cases; line.status = "TRIMMED"; }
      else { line.cases = 0; line.status = "REJECTED"; }
    }
    const rename = (id: string) => id.replace(/-v\d+-/, `-v${next.version}-`);
    for (const line of next.lines) line.line_id = rename(line.line_id);
    for (const truck of next.trucks) truck.line_ids = truck.line_ids.map(rename);
    return next;
  }

  async runExperiment(id: string): Promise<ExperimentOutcome> {
    this.results.set(id, { ...clone<ExperimentResults>(results), experiment_id: id });
    return { status: "done" };
  }

  async experimentResults(id: string) { return this.results.get(id) ?? null; }
  async close() {}
}
