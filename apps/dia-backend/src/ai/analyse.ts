/**
 * Analysis on demand (PRD FR-25). Two paths, one result shape:
 *  - rules: deterministic text built from the facts; works offline and is the fallback.
 *  - ai: a Vertex AI model writes the analysis from the same facts. Its output is checked: every figure it quotes must
 *    appear in the facts (allowing unit conversion), otherwise the answer is flagged. The model never sets a quantity.
 */
import type { Facts } from "./facts";
import type { LlmClient } from "./vertex";

export interface Analysis {
  text: string;
  source: "ai" | "rules";
  model: string | null;
  verified: boolean;
  unverified_numbers: number[];
  note: string | null;
}

export const inr = (v: number): string => {
  const a = Math.abs(v), s = v < 0 ? "-" : "";
  return a >= 1e7 ? `${s}₹${(a / 1e7).toFixed(2)} crore` : a >= 1e5 ? `${s}₹${(a / 1e5).toFixed(1)} lakh` : `${s}₹${Math.round(a).toLocaleString("en-IN")}`;
};
const pct = (v: number, d = 1) => `${v.toFixed(d)}%`;
const num = (v: unknown) => Number(v);

// ------------------------------------------------------------------------------------------------ rules text

function planRules(f: Facts): string {
  const costs = f.expected_cost_inr as Record<string, number>;
  const cost = { freight: num(costs.freight), lost_margin: num(costs.lost_margin), holding: num(costs.holding), expiry: num(costs.expiry), total: num(costs.total) };
  const total = cost.total || 1;
  const reasons = f.main_reasons as Array<{ code: string; cases: number; lines: number }>;
  const lanes = f.top_lanes as Array<{ from: string; to: string; cases: number; freight_inr: number }>;
  const fillRaw = f.truck_fill as Record<string, number>;
  const fill = { ftl_trucks: num(fillRaw.ftl_trucks), ptl_consignments: num(fillRaw.ptl_consignments), avg_weight_pct: num(fillRaw.avg_weight_pct), avg_volume_pct: num(fillRaw.avg_volume_pct) };
  const sf = f.shortfalls as { pairs_below_target: number; short_cases_total: number; largest: Array<{ distributor: string; sku: string; short_cases: number; reason: string }> };
  const cliff = f.cliff_rescue as { lines: number; write_off_avoided_inr: number };
  const out: string[] = [];
  out.push(`Summary: ${f.lines} lines on ${f.trucks} trucks move ${num(f.cases).toLocaleString("en-IN")} cases. Expected cost to serve is ${inr(total)}: freight ${inr(cost.freight)} (${pct((100 * cost.freight) / total, 0)}), expected lost margin ${inr(cost.lost_margin)}, holding ${inr(cost.holding)}, expiry ${inr(cost.expiry)}.`);
  if (reasons.length) out.push(`What drives the plan: ${reasons.slice(0, 3).map((r) => `${r.code} (${r.cases.toLocaleString("en-IN")} cases on ${r.lines} lines)`).join("; ")}.`);
  if (lanes.length) out.push(`Biggest lanes: ${lanes.slice(0, 3).map((l) => `${l.from} to ${l.to} (${l.cases.toLocaleString("en-IN")} cases, freight ${inr(l.freight_inr)})`).join("; ")}.`);
  out.push(`Truck fill: ${fill.ftl_trucks} full trucks average ${fill.avg_weight_pct}% by weight and ${fill.avg_volume_pct}% by volume${fill.ptl_consignments ? `, plus ${fill.ptl_consignments} part-load consignments` : ""}.`);
  const attention: string[] = [];
  if (sf.pairs_below_target > 0) attention.push(`${sf.pairs_below_target} SKU and distributor pairs end below target stock (${sf.short_cases_total.toLocaleString("en-IN")} cases short in total); the largest is ${sf.largest[0] ? `${sf.largest[0].sku} at ${sf.largest[0].distributor}, ${sf.largest[0].short_cases} cases short${sf.largest[0].reason !== "none" ? ` (${sf.largest[0].reason})` : ""}` : "none"}`);
  if (num(f.credit_limited_lines) > 0) attention.push(`${f.credit_limited_lines} lines are capped by distributor credit`);
  if (num(f.storage_limited_lines) > 0) attention.push(`${f.storage_limited_lines} lines are capped by godown space`);
  if (num(f.stock_limited_lines) > 0) attention.push(`${f.stock_limited_lines} lines are limited by usable stock at the depot`);
  if (cliff.lines > 0) attention.push(`${cliff.lines} lines rescue stock about to fall below the shelf-life floor, avoiding about ${inr(cliff.write_off_avoided_inr)} of write-off`);
  out.push(attention.length ? `Worth checking: ${attention.join("; ")}.` : "Worth checking: nothing unusual; no shortfalls, credit or storage limits are binding.");
  if (sf.pairs_below_target > 0 && num(f.credit_limited_lines) > 0) out.push("Before approving: ask whether any distributor's credit limit can be raised for the festival run-up, since credit is holding back shipments.");
  return out.join("\n\n");
}

function resultsRules(f: Facts): string {
  const k = f.kpis as Array<{ kpi: string; engine: number; difference_vs_best_baseline: number; relative_difference_pct: number | null; direction: string }>;
  const better = k.filter((x) => x.direction === "engine better"), worse = k.filter((x) => x.direction === "engine worse"), same = k.filter((x) => x.direction === "no clear difference");
  const RATE = new Set(["Fill rate", "Festival-week fill rate", "Stockout rate", "FTL utilisation", "Cover extremes"]);
  const describe = (x: (typeof k)[number]) => {
    if (RATE.has(x.kpi)) { const pp = x.difference_vs_best_baseline * 100; return `${x.kpi} (${pp > 0 ? "+" : ""}${pp.toFixed(1)} pp)`; }
    return `${x.kpi}${x.relative_difference_pct != null ? ` (${x.relative_difference_pct > 0 ? "+" : ""}${x.relative_difference_pct}%)` : ""}`;
  };
  const out: string[] = [];
  const cost = k.find((x) => x.kpi === "Total cost to serve");
  out.push(`Verdict (${f.opening_state} start, ${f.seeds} seeds): ${cost ? `total cost to serve is ${cost.relative_difference_pct}% against the better baseline (${cost.direction})` : "no cost result"}. The engine is clearly better on ${better.length} KPIs, clearly worse on ${worse.length}, and not distinguishable on ${same.length}.`);
  if (better.length) out.push(`Better: ${better.map(describe).join("; ")}.`);
  if (worse.length) out.push(`Worse: ${worse.map(describe).join("; ")}. The engine ships a case only when the expected margin beats freight, holding and expiry cost, so it accepts some extra stockouts on thin lanes in return for fuller trucks and less waste.`);
  if (same.length) out.push(`No clear difference: ${same.map((x) => x.kpi).join("; ")}.`);
  const abl = f.ablation as Array<{ switched_off: string; extra_cost_to_serve_inr: number; interval_low: number; interval_high: number }>;
  if (abl.length) out.push(`What the mechanisms are worth (cost to serve when switched off): ${abl.map((a) => `${a.switched_off} ${a.extra_cost_to_serve_inr >= 0 ? "+" : ""}${inr(a.extra_cost_to_serve_inr)}`).join("; ")}. A negative figure means the engine does better without that mechanism.`);
  out.push(`Caveats: ${(f.caveats as string[]).join(" ")}`);
  return out.join("\n\n");
}

function lineRules(f: Facts): string {
  const r = f.reasons as Array<{ code: string; detail: string; impact_inr: number }>;
  return `${f.sku}: ${f.cases} cases from ${f.from} to ${f.to} by ${f.mode === "FTL" ? "a full truck" : "part-load"}, arriving with ${f.life_on_arrival_days} days of life left, freight ${inr(num(f.freight_alloc_inr))}.\n\n${r.length ? r.map((x) => `${x.code}: ${x.detail}`).join("\n") : "No reason recorded."}`;
}

export function rulesText(f: Facts): string {
  return f.kind === "plan" ? planRules(f) : f.kind === "results" ? resultsRules(f) : f.kind === "line" ? lineRules(f) : "Nothing to analyse.";
}

// ------------------------------------------------------------------------------------------------ verification

function factNumbers(v: unknown, out: number[] = []): number[] {
  if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => factNumbers(x, out));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => factNumbers(x, out));
  else if (typeof v === "string") for (const m of v.matchAll(/\d[\d,]*\.?\d*/g)) out.push(Number(m[0].replaceAll(",", "")));
  return out;
}

/** Figures in `text` that match no fact (after unit conversion). Small counts and years are ignored. */
export function unverifiedNumbers(text: string, facts: Facts, question = ""): number[] {
  const asked = [...question.matchAll(/\d[\d,]*\.?\d*/g)].map((m) => Number(m[0].replaceAll(",", "").replace(/\.$/, "")));
  const known = [...factNumbers(facts).flatMap((v) => { const a = Math.abs(v); return [v, a, a / 1e5, a / 1e7, a * 100]; }), ...asked];
  const bad: number[] = [];
  for (const m of text.matchAll(/\d[\d,]*\.?\d*/g)) {
    const n = Number(m[0].replaceAll(",", "").replace(/\.$/, ""));
    if (!Number.isFinite(n) || (Number.isInteger(n) && n <= 12) || (n >= 2000 && n <= 2035)) continue;
    const tol = Math.max(0.06, 0.015 * n);
    if (!known.some((k) => Math.abs(k - n) <= tol)) bad.push(n);
  }
  return [...new Set(bad)];
}

// ------------------------------------------------------------------------------------------------ orchestration

export const SYSTEM_PROMPT = [
  "You explain the output of an inventory and distribution optimiser to a supply-chain manager.",
  "Use ONLY figures that appear in FACTS. You may convert units (rupees to lakh or crore). Do not calculate new percentages, shares or differences: use the *_pct and difference fields FACTS already gives.",
  "Never propose, change or estimate quantities, order sizes or prices. Never invent data, causes you cannot see in FACTS, or sources.",
  "If a question cannot be answered from FACTS, say so plainly.",
  "Write plain English in short paragraphs or bullets, at most 250 words, with no markdown tables or headings.",
].join(" ");

function task(facts: Facts, question?: string): string {
  if (question) return `Answer this question using only FACTS: ${question}`;
  if (facts.kind === "plan") return "Give a deep analysis for the planner: what the plan does and why, the biggest cost drivers, risks and what to check, and one question to ask before approving.";
  if (facts.kind === "results") return "Give a deep analysis: the verdict against the better baseline, where the engine is worse and why, what the ablations and frontier imply, and the caveats.";
  return "Explain this plan line to a planner: why it exists and what the reasons mean in rupees.";
}

export async function analyse(llm: LlmClient | null, facts: Facts, question?: string, timeoutMs = 30_000): Promise<Analysis> {
  const offlineNote = question ? "Free-form questions need the AI model; showing the rules-based analysis instead." : null;
  if (!llm) return { text: rulesText(facts), source: "rules", model: null, verified: true, unverified_numbers: [], note: offlineNote };
  try {
    const text = await Promise.race([
      llm.generate(SYSTEM_PROMPT, `FACTS (JSON):\n${JSON.stringify(facts)}\n\nTASK: ${task(facts, question)}`),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("AI request timed out")), timeoutMs)),
    ]);
    const bad = unverifiedNumbers(text, facts, question ?? "");
    return { text, source: "ai", model: llm.model, verified: bad.length === 0, unverified_numbers: bad,
      note: bad.length ? "Some figures in this answer do not match the data; check them before relying on them." : null };
  } catch (e) {
    return { text: rulesText(facts), source: "rules", model: null, verified: true, unverified_numbers: [], note: `AI unavailable (${(e as Error).message}); showing the rules-based analysis.` };
  }
}
