/**
 * Model routing for the sidebar assistant. Used only when the rules find no tool.
 * The model picks one tool from a fixed list and fills a few parameters. Every value is checked here:
 * unknown tools, unknown cities or depots, and out-of-range percentages are dropped. The model never gives quantities.
 */
import type { WhatIf } from "@dia/types";
import type { LlmClient } from "../ai/vertex";
import { PAGES, type DistRef, type Intent, type Page, type Tool, type ViewChange } from "./intent";
import { isIsoDate } from "./viewTools";

const TOOLS: Tool[] = [
  "explain_order",
  "orders_status",
  "credit_report",
  "check_at_risk",
  "whatif",
  "publish_plan",
  "replan",
  "navigate",
  "set_view",
  "explain_results",
  "explain_demand",
];
const DEPOT_IDS = ["W1-Bhiwandi", "N1-Gurugram", "S1-Hosur", "E1-Dankuni"];
const REGIONS = ["N", "S", "E", "W"];

/** A product the sentence can name. */
export type SkuRef = { sku_id: string; name: string };

export const ROUTE_SYSTEM = [
  "You route one sentence from a supply planner to exactly one tool, and fill a few parameters.",
  "Reply with JSON only, no prose, in this shape:",
  '{"tool": "...", "dist_city": null, "diesel_pct": null, "demand_shock_pct": null, "shock_region": null, "depot_outage_id": null, "page": null, "opening_state": null, "sku_name": null, "seed": null, "as_of": null}',
  "tool is one of: explain_order (a question about one distributor's order; set dist_city to a city from the list),",
  "orders_status (totals of the plan), credit_report (which distributors are at their credit limit),",
  "check_at_risk (stock that may expire), whatif (a what-if scenario: diesel_pct for a fuel price change in percent,",
  "demand_shock_pct and shock_region N, S, E or W for a demand change, depot_outage_id for a depot that cannot ship),",
  "publish_plan (only when the planner asks to approve, send or publish), replan (only to build a new version),",
  "navigate (the planner asks to open a page; page is one of planning, demand, results, frontier, map, stock),",
  "set_view (the planner asks to show or filter a page: opening_state neutral or imbalanced, dist_city, sku_name,",
  "seed 1 or 2, as_of as YYYY-MM-DD),",
  "explain_results (a question about the evaluation results or the frontier), explain_demand (a question about the demand forecast),",
  "or unknown.",
  "Use null for anything the sentence does not say. Never give quantities, prices, stock or cost numbers.",
].join(" ");

/** Parses and checks the model's reply. Returns null when the reply is not a usable route. */
export function validateRoute(raw: string, dists: DistRef[], skus: SkuRef[] = []): Intent | null {
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

  if (tool === "navigate") {
    const page = PAGES.find((p) => p === r.page);
    return page ? { tool, page } : null;
  }

  if (tool === "set_view") {
    const view = viewFrom(r, dists, skus);
    return view ? { tool, view } : null;
  }

  return { tool };
}

/** Filter values from the model's reply, each checked against the scenario. Null when none is usable. */
function viewFrom(r: Record<string, unknown>, dists: DistRef[], skus: SkuRef[]): ViewChange | null {
  const view: ViewChange = {};
  const state = r.opening_state;
  if (state === "neutral" || state === "imbalanced") view.opening_state = state;
  if (typeof r.dist_city === "string") {
    const city = r.dist_city.toLowerCase();
    const dist = dists.find((d) => d.city.toLowerCase() === city);
    if (dist) view.dist_id = dist.dist_id;
  }
  if (typeof r.sku_name === "string") {
    const name = r.sku_name.trim().toLowerCase();
    const sku = name ? skus.find((s) => s.name.toLowerCase() === name || s.name.toLowerCase().includes(name)) : undefined;
    if (sku) view.sku_id = sku.sku_id;
  }
  const seed = r.seed;
  if (seed === 1 || seed === 2) view.seed = seed;
  if (typeof r.as_of === "string" && isIsoDate(r.as_of)) view.as_of = r.as_of;
  return Object.keys(view).length ? view : null;
}

function numberIn(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < min || value > max) return undefined;
  return value;
}

/** Asks the model for a route. Returns null on any failure so the caller can fall back to the help text. */
export async function routeWithModel(llm: LlmClient, message: string, dists: DistRef[], skus: SkuRef[] = [], page: Page = "planning"): Promise<Intent | null> {
  try {
    const cities = dists.map((d) => d.city).join(", ");
    const products = skus.map((s) => s.name).join(", ");
    const reply = await llm.generate(ROUTE_SYSTEM, `Current page: ${page}\nDistributor cities: ${cities}\nProducts: ${products}\nSentence: ${message}`);
    return validateRoute(reply, dists, skus);
  } catch {
    return null;
  }
}
