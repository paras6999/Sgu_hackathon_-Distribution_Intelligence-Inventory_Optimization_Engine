/**
 * Model routing for the sidebar assistant. Used only when the rules find no tool.
 * The model picks one tool from a fixed list and fills a few parameters. Every value is checked here:
 * unknown tools, unknown cities or depots, and out-of-range percentages are dropped. The model never gives quantities.
 */
import type { WhatIf } from "@dia/types";
import type { LlmClient } from "../ai/vertex";
import type { DistRef, Intent, Tool } from "./intent";

const TOOLS: Tool[] = [
  "explain_order",
  "orders_status",
  "credit_report",
  "check_at_risk",
  "whatif",
  "publish_plan",
  "replan",
  "answer_question",
];
const DEPOT_IDS = ["W1-Bhiwandi", "N1-Gurugram", "S1-Hosur", "E1-Dankuni"];
const REGIONS = ["N", "S", "E", "W"];

export const ROUTE_SYSTEM = [
  "You route one sentence from a supply planner to exactly one tool, and fill a few parameters.",
  "Reply with JSON only, no prose, in this shape:",
  '{"tool": "...", "dist_city": null, "diesel_pct": null, "demand_shock_pct": null, "shock_region": null, "depot_outage_id": null}',
  "tool is one of: explain_order (a question about one distributor's order; set dist_city to a city from the list),",
  "orders_status (totals of the plan), credit_report (which distributors are at their credit limit),",
  "check_at_risk (stock that may expire), whatif (a what-if scenario: diesel_pct for a fuel price change in percent,",
  "demand_shock_pct and shock_region N, S, E or W for a demand change, depot_outage_id for a depot that cannot ship),",
  "publish_plan (only when the planner asks to approve, send or publish), replan (only to build a new version),",
  "answer_question (any other question about this plan: its costs, freight, trucks, products, reasons or distributors), or unknown.",
  "Use null for anything the sentence does not say. Never give quantities, prices, stock or cost numbers.",
].join(" ");

/** Parses and checks the model's reply. Returns null when the reply is not a usable route. */
export function validateRoute(raw: string, dists: DistRef[]): Intent | null {
  const json = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let body: unknown;
  try {
    body = JSON.parse(json);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const r = body as Record<string, unknown>;
  const tool = typeof r.tool === "string" ? (r.tool as Tool) : null;
  if (!tool || !TOOLS.includes(tool)) return null;

  if (tool === "explain_order") {
    const city = typeof r.dist_city === "string" ? r.dist_city.toLowerCase() : "";
    const dist = dists.find((d) => d.city.toLowerCase() === city);
    return dist ? { tool, dist_id: dist.dist_id } : null;
  }

  if (tool === "whatif") {
    const what: WhatIf = {};
    const diesel = numberIn(r.diesel_pct, -50, 200);
    if (diesel !== undefined) what.diesel_pct = diesel;
    const demand = numberIn(r.demand_shock_pct, -90, 300);
    if (demand !== undefined) what.demand_shock_pct = demand;
    if (typeof r.shock_region === "string" && REGIONS.includes(r.shock_region)) {
      what.shock_region = r.shock_region as "N" | "S" | "E" | "W";
    }
    if (typeof r.depot_outage_id === "string" && DEPOT_IDS.includes(r.depot_outage_id)) {
      what.depot_outage_id = r.depot_outage_id;
    }
    if (Object.keys(what).length === 0) return null;
    return { tool, what_if: what };
  }

  return { tool };
}

function numberIn(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}

/** Asks the model for a route. Returns null on any failure so the caller can fall back to the help text. */
export async function routeWithModel(llm: LlmClient, message: string, dists: DistRef[]): Promise<Intent | null> {
  try {
    const cities = dists.map((d) => d.city).join(", ");
    const reply = await llm.generate(ROUTE_SYSTEM, `Distributor cities: ${cities}\nSentence: ${message}`);
    return validateRoute(reply, dists);
  } catch {
    return null;
  }
}
