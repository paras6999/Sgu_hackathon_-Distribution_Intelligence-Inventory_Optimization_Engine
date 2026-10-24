/**
 * FakeEngine (owner: M2): every call answers from packages/dia-types/fixtures, so the backend and web
 * work before any engine code exists. resolve() applies actions directly (no re-solve, nothing grows).
 */
import type {
  AssumptionRow, BacktestMetrics, DemandHistory, EnginePlanRequest, EngineResolveRequest, ExperimentResults, ForecastBundle,
  LearnedEffects, Plan, Scenario, Snapshot,
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

  /** Small deterministic series for demos and tests: a seasonal wave with a Diwali bump and a 12-week backtest. */
  async history(id: string, distId?: string, skuId?: string): Promise<DemandHistory> {
    const weeks = 117, start = Date.UTC(2023, 8, 25);
    const iso = (i: number) => new Date(start + i * 7 * 86400000).toISOString().slice(0, 10);
    const level = (i: number) => 100 + 25 * Math.sin((2 * Math.PI * i) / 52) + (i === 56 || i === 57 ? 60 : 0);
    const weekly = Array.from({ length: weeks }, (_, i) => ({ week_start: iso(i), actual: Math.round(level(i)) }));
    const backtest = Array.from({ length: 48 }, (_, k) => {
      const i = 55 + k, a = weekly[i]!.actual, p50 = Math.round(a * 0.95);
      return { week_start: iso(i), actual: a, p10: Math.round(p50 * 0.8), p50, p90: Math.round(p50 * 1.2), naive: Math.round(weekly[i - 52]?.actual ?? a) };
    });
    return {
      scenario_id: id, label: `${distId ?? "All distributors"} · ${skuId ?? "all SKUs"}`, dist_id: distId ?? null, sku_id: skuId ?? null,
      weekly, backtest, has_band: !!(distId && skuId),
      festivals: [{ name: "Diwali", start: "2024-10-20", end: "2024-11-01" }, { name: "Diwali", start: "2025-10-10", end: "2025-10-20" }],
    };
  }
  async effects(id: string): Promise<LearnedEffects> {
    return {
      scenario_id: id,
      festivals: [{ name: "Diwali", learned: { snacks: 1.37, dairy: 1.26 }, configured: { snacks: 1.5, dairy: 1.3 } }],
      weather: [{ category: "beverages", heat_pct_per_degc_learned: 0.5, heat_pct_per_degc_configured: 4, rain_cut_pct_learned: 13.2, rain_cut_pct_configured: 15 }],
      seasonality: { beverages: [0.98, 0.99, 0.98, 1.04, 1.04, 1.04, 0.96, 0.97, 1.03, 1, 0.96, 1] },
      seasonality_configured: { beverages: [0.78, 0.85, 1.05, 1.3, 1.4, 1.2, 0.95, 0.92, 0.95, 0.98, 0.85, 0.8] },
    };
  }
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
