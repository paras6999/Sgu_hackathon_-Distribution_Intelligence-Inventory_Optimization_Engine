/**
 * Facts for the AI layer (PRD FR-25, Rules.md). Everything an analysis may mention is computed here from the plan
 * or the cached experiment. The language model only sees these facts and may not introduce figures of its own.
 */
import type { ExperimentResults, KpiSummary, OpeningState, Plan, Scenario } from "@dia/types";

export type Facts = Record<string, unknown>;

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const cityOf = (scenario: Scenario | null, id: string) => scenario?.nodes.find((n) => n.node_id === id)?.city ?? id;

export function planFacts(plan: Plan, scenario: Scenario | null = null): Facts {
  const byCode = new Map<string, { cases: number; lines: number; impact_inr: number }>();
  const lanes = new Map<string, { from: string; to: string; cases: number; freight_inr: number }>();
  let cliff = { lines: 0, write_off_avoided_inr: 0 };
  const limited = { credit_limited_lines: 0, storage_limited_lines: 0, stock_limited_lines: 0 };
  for (const l of plan.lines) {
    const main = l.reasons?.[0];
    if (main) {
      const c = byCode.get(main.code) ?? { cases: 0, lines: 0, impact_inr: 0 };
      c.cases += l.cases; c.lines += 1; c.impact_inr += main.impact_inr ?? 0;
      byCode.set(main.code, c);
    }
    for (const r of l.reasons ?? []) {
      if (r.code === "CLIFF_RESCUE") { cliff.lines += 1; cliff.write_off_avoided_inr += r.impact_inr ?? 0; }
      if (r.code === "CREDIT_LIMITED") limited.credit_limited_lines += 1;
      if (r.code === "STORAGE_LIMITED") limited.storage_limited_lines += 1;
      if (r.code === "STOCK_LIMITED") limited.stock_limited_lines += 1;
    }
    const key = `${l.from_id}>${l.to_id}`;
    const lane = lanes.get(key) ?? { from: cityOf(scenario, l.from_id), to: cityOf(scenario, l.to_id), cases: 0, freight_inr: 0 };
    lane.cases += l.cases; lane.freight_inr += l.freight_alloc_inr;
    lanes.set(key, lane);
  }
  const ftl = plan.trucks.filter((t) => t.mode === "FTL");
  const k = { freight_inr: 0, lost_margin_inr: 0, holding_inr: 0, expiry_inr: 0, carbon_kg: 0, total_inr: 0, ...plan.expected_kpis };
  const short = (plan.shortfalls ?? []).slice().sort((a, b) => b.short_cases - a.short_cases);
  return {
    kind: "plan", plan_id: plan.plan_id, version: plan.version, as_of: plan.as_of, temp_class: plan.temp_class,
    policy: plan.policy, lines: plan.lines.length, trucks: plan.trucks.length,
    cases: plan.lines.reduce((s, l) => s + l.cases, 0),
    expected_cost_inr: { freight: round(k.freight_inr, 0), lost_margin: round(k.lost_margin_inr, 0), holding: round(k.holding_inr, 0), expiry: round(k.expiry_inr, 0), total: round(k.total_inr, 0) },
    carbon_kg: round(k.carbon_kg, 0),
    main_reasons: [...byCode.entries()].map(([code, v]) => ({ code, ...v, impact_inr: round(v.impact_inr, 0) })).sort((a, b) => b.cases - a.cases).slice(0, 6),
    top_lanes: [...lanes.values()].sort((a, b) => b.cases - a.cases).slice(0, 5).map((l) => ({ ...l, freight_inr: round(l.freight_inr, 0) })),
    truck_fill: {
      ftl_trucks: ftl.length, ptl_consignments: plan.trucks.length - ftl.length,
      avg_weight_pct: ftl.length ? round(ftl.reduce((s, t) => s + t.kg_pct, 0) / ftl.length, 0) : 0,
      avg_volume_pct: ftl.length ? round(ftl.reduce((s, t) => s + t.m3_pct, 0) / ftl.length, 0) : 0,
    },
    shortfalls: {
      pairs_below_target: short.length, short_cases_total: round(short.reduce((s, x) => s + x.short_cases, 0), 0),
      largest: short.slice(0, 3).map((x) => ({ distributor: cityOf(scenario, x.dist_id), sku: x.sku_id, short_cases: round(x.short_cases, 0), reason: x.reasons?.[0]?.code ?? "none" })),
    },
    cliff_rescue: { lines: cliff.lines, write_off_avoided_inr: round(cliff.write_off_avoided_inr, 0) },
    ...limited,
    solve: { status: plan.solve.status, seconds: plan.solve.seconds },
  };
}

export function lineFacts(plan: Plan, lineId: string, scenario: Scenario | null = null): Facts | null {
  const l = plan.lines.find((x) => x.line_id === lineId);
  if (!l) return null;
  return {
    kind: "line", line_id: l.line_id, sku: l.sku_name, from: cityOf(scenario, l.from_id), to: cityOf(scenario, l.to_id), cases: l.cases,
    mode: l.mode, truck_class: l.truck_class ?? "PTL", life_on_arrival_days: l.rsl_on_arrival_days, freight_alloc_inr: round(l.freight_alloc_inr, 0),
    reasons: (l.reasons ?? []).map((r) => ({ code: r.code, detail: r.detail, impact_inr: round(r.impact_inr ?? 0, 0) })),
  };
}

const HIGHER_BETTER = new Set(["fill_rate", "festival_fill_rate", "ftl_utilisation"]);
const LABEL: Record<string, string> = {
  fill_rate: "Fill rate", festival_fill_rate: "Festival-week fill rate", stockout_rate: "Stockout rate", lost_margin_inr: "Lost margin",
  wastage_inr: "Wastage", freight_inr_per_case: "Freight per case", ftl_utilisation: "FTL utilisation", cost_to_serve_inr: "Total cost to serve",
  cover_extremes: "Cover extremes", co2_kg_per_case: "CO2 per case",
};

export function resultsFacts(res: ExperimentResults, state: OpeningState): Facts {
  const rows = res.kpis.filter((k) => k.opening_state === state);
  const get = (kpi: string, policy: string): KpiSummary | undefined => rows.find((k) => k.kpi === kpi && k.policy === policy);
  const kpis = Object.keys(LABEL).flatMap((kpi) => {
    const e = get(kpi, "engine");
    if (!e || e.delta_vs_best_baseline == null) return [];
    const best = e.mean - e.delta_vs_best_baseline;
    const lo = Math.min(e.delta_ci_low ?? 0, e.delta_ci_high ?? 0), hi = Math.max(e.delta_ci_low ?? 0, e.delta_ci_high ?? 0);
    const better = HIGHER_BETTER.has(kpi) ? e.delta_vs_best_baseline > 0 : e.delta_vs_best_baseline < 0;
    const significant = lo > 0 || hi < 0;
    return [{
      kpi: LABEL[kpi], baseline_a: round(get(kpi, "baseline_a")?.mean ?? NaN, 4), baseline_b: round(get(kpi, "baseline_b")?.mean ?? NaN, 4), engine: round(e.mean, 4),
      difference_vs_best_baseline: round(e.delta_vs_best_baseline, 4), relative_difference_pct: best ? round((100 * e.delta_vs_best_baseline) / best, 1) : null,
      interval_low: round(lo, 4), interval_high: round(hi, 4), direction: !significant ? "no clear difference" : better ? "engine better" : "engine worse",
    }];
  });
  return {
    kind: "results", experiment_id: res.experiment_id, opening_state: state, seeds: get("cost_to_serve_inr", "engine")?.n_seeds ?? null,
    kpis,
    ablation: (res.ablation ?? []).filter((a) => a.opening_state === state).map((a) => ({
      switched_off: a.variant, extra_cost_to_serve_inr: round(a.delta_cost_to_serve_inr, 0), interval_low: round(a.ci_low, 0), interval_high: round(a.ci_high, 0),
      fill_rate_change_pp: round(a.delta_fill_rate_pp, 1),
    })),
    frontier: (res.frontier ?? []).filter((p) => p.opening_state === state).map((p) => ({ policy: p.policy, knob: p.param, value: p.value, fill_rate: round(p.fill_rate, 4), cost_to_serve_inr: round(p.cost_to_serve_inr, 0) })),
    caveats: [
      "Demand, stock lots, orders and delays are simulated; weather, locations and festival dates are real.",
      "Ablations and frontier points ran on the first 5 seeds, the headline on 10.",
      "The stockout penalty was tuned on seeds that are also in the evaluation.",
    ],
  };
}
