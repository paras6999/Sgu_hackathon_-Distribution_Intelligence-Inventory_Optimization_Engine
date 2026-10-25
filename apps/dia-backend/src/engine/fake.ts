/**
 * FakeEngine (owner: M2): every call answers from packages/dia-types/fixtures, so the backend and web
 * work before any engine code exists. resolve() applies actions directly (no re-solve, nothing grows).
 */
import type {
  AssumptionRow, AtRisk, BacktestMetrics, DemandHistory, EnginePlanRequest, EngineResolveRequest, ExperimentResults, ForecastBundle,
  LearnedEffects, OpeningState, Plan, Scenario, Snapshot, SpaceNode, SpaceReport, Trajectory, TrajectoryPoint,
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

  /**
   * FAKE DATA (not engine output): space from the scenario and snapshot fixtures. Depot stores have no capacity in the
   * fixture, so each is given room for its stock at 80% full (at least 10 m3); godowns use their fixture storage_m3.
   */
  async space(scenarioId: string, asOf: string, openingState: OpeningState): Promise<SpaceReport> {
    const sc = scenario as Scenario, snap = snapshot as Snapshot;
    const sku = new Map(sc.skus.map((s) => [s.sku_id, s]));
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const node = (n: Scenario["nodes"][number], temp: "ambient" | "chilled" | null, cap: number, used: number, cases: number): SpaceNode => {
      const free = Math.max(cap - used, 0);
      return {
        node_type: n.type, node_id: n.node_id, city: n.city, region: n.region, temp_class: temp,
        capacity_m3: r1(cap), used_m3: r1(used), free_m3: r1(free), used_pct: cap > 0 ? r1((100 * used) / cap) : 0, cases: r1(cases),
        fits: sc.skus.filter((s) => temp === null || s.temp_class === temp).map((s) => ({ sku_id: s.sku_id, sku_name: s.name, cases: Math.floor(free / s.m3_per_case) })),
      };
    };
    const depots = sc.nodes.filter((n) => n.type === "depot").flatMap((n) => (["ambient", "chilled"] as const).map((t) => {
      const lots = snap.depot_lots.filter((l) => l.depot_id === n.node_id && sku.get(l.sku_id)?.temp_class === t);
      const used = lots.reduce((a, l) => a + l.qty_cases * (sku.get(l.sku_id)?.m3_per_case ?? 0), 0);
      return node(n, t, Math.max(used / 0.8, 10), used, lots.reduce((a, l) => a + l.qty_cases, 0));
    }));
    const distributors = sc.nodes.filter((n) => n.type === "distributor").map((n) => {
      const rows = [...snap.dist_stock.filter((d) => d.dist_id === n.node_id), ...snap.in_transit.filter((t) => t.to_id === n.node_id)];
      const used = rows.reduce((a, r) => a + r.qty_cases * (sku.get(r.sku_id)?.m3_per_case ?? 0), 0);
      return node(n, null, n.storage_m3 ?? 0, used, rows.reduce((a, r) => a + r.qty_cases, 0));
    });
    return { scenario_id: scenarioId, as_of: asOf, opening_state: openingState, depots, distributors };
  }

  /**
   * FAKE DATA (not engine output): at-risk lots are the snapshot fixture's distributor stock rows that have a lot and stock.
   * Demand is a flat 8% of stock per day and expected values follow from that. Scenario id, as-of and opening state
   * do not change the result beyond the days-left calculation.
   */
  async atRisk(_scenarioId: string, asOf: string): Promise<AtRisk[]> {
    const city = new Map((scenario as Scenario).nodes.map((n) => [n.node_id, n.city]));
    const name = new Map((scenario as Scenario).skus.map((s) => [s.sku_id, s.name]));
    const asOfMs = Date.parse(asOf);
    return (snapshot as Snapshot).dist_stock
      .filter((r) => r.lot_id && r.qty_cases > 0)
      .map((r) => {
        const daysLeft = Math.round((Date.parse(r.expiry_date) - asOfMs) / 86400000);
        const daily = Math.max(0.1, Math.round(r.qty_cases * 0.8) / 10);
        const expired = Math.min(r.qty_cases, Math.max(0, Math.round((r.qty_cases - daily * daysLeft) * 10) / 10));
        return {
          dist_id: r.dist_id, dist_city: city.get(r.dist_id) ?? r.dist_id, sku_id: r.sku_id, sku_name: name.get(r.sku_id) ?? r.sku_id,
          lot_id: r.lot_id, expiry: r.expiry_date, days_left: daysLeft, stock_cases: r.qty_cases, daily_demand_cases: daily,
          expected_days_to_sell: Math.round((r.qty_cases / daily) * 10) / 10, expected_expired_cases: expired,
          suggested_action: expired > 0 ? `Discount or return before ${r.expiry_date}` : "Watch", holder_type: "distributor",
        };
      });
  }
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

  /**
   * FAKE DATA (not engine output): a 28-day stock walk per policy, derived from sku, distributor, seed and opening state.
   * Unknown experiment ids (never run in this process) return null.
   */
  async trajectory(experimentId: string, q: { sku_id: string; dist_id: string; opening_state: OpeningState; seed: number }): Promise<Trajectory | null> {
    if (!this.results.has(experimentId)) return null;
    const hash = [...`${q.sku_id}|${q.dist_id}`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 997, 0);
    const demand = 4 + ((hash + q.seed * 7) % 9);   // cases per day
    const weekday = [1.1, 1.0, 0.95, 0.9, 1.0, 1.2, 1.25];
    const start = Date.UTC(2025, 9, 13);
    const policies: [string, number][] = [["engine", 1], ["baseline_a", 0.9], ["baseline_b", 0.8]];   // receipt size as a share of plan
    const opening = demand * (q.opening_state === "neutral" ? 7 : 3);
    const series = policies.map(([policy, receiptShare]) => {
      let closing = opening;
      const points: TrajectoryPoint[] = [];
      for (let d = 0; d < 28; d++) {
        const receipt = d % 7 === 0 ? Math.round(demand * 7.4 * receiptShare) : 0;
        const available = closing + receipt;
        const want = Math.round(demand * weekday[d % 7]!);
        const sales = Math.min(available, want);
        closing = available - sales;
        const expired = Math.max(0, closing - 14 * demand);   // written off above 14 days of cover
        closing -= expired;
        points.push({
          date: new Date(start + d * 86400000).toISOString().slice(0, 10),
          closing_cases: closing, sales_cases: sales, lost_cases: want - sales, expired_cases: expired,
        });
      }
      return { policy, points };
    });
    return { experiment_id: experimentId, sku_id: q.sku_id, dist_id: q.dist_id, opening_state: q.opening_state, seed: q.seed, series };
  }
  async close() {}
}
