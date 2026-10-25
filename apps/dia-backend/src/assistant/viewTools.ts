/**
 * Sidebar assistant: page tools. Pure: one sentence and the page the planner is on in, one intent out.
 * Navigation, filter changes and lane selection are returned as UI actions that the page applies. Page
 * analysis is answered by the backend. Nothing here sets a quantity.
 */
import type { Intent, Page, ViewChange } from "./intent";

export const PAGE_LABEL: Record<Page, string> = {
  planning: "Planning",
  demand: "Demand analysis",
  results: "Results",
  frontier: "Frontier & Ablation",
  map: "Map",
  stock: "Stock watch",
};

/** Places (depots and distributors) and products the sentence can name, taken from the scenario. */
export type ViewRefs = {
  places: Array<{ node_id: string; type: "depot" | "distributor"; city: string }>;
  skus: Array<{ sku_id: string; name: string }>;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (text: string, word: string) => new RegExp(`\\b${escapeRe(word)}\\b`).test(text);

/** A real calendar date in YYYY-MM-DD form. */
export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
}

const NAV_VERB = /\b(open|go to|take me to|show me)\b/;
const PAGE_WORDS: Array<[RegExp, Page]> = [
  [/\b(planning|plan)\b/, "planning"],
  [/\bdemand\b/, "demand"],
  [/\bresults?\b/, "results"],
  [/\b(frontier|ablation)\b/, "frontier"],
  [/\bmap\b/, "map"],
  [/\bstock\b/, "stock"],
];
/** Questions and analysis requests. A set-view sentence with these words is left to the analysis tools. */
const ASK = /\b(why|how|explain|analy\w*|which|risk|expir\w*)\b/;
/** Sentences about changing the plan or a scenario. Analysis tools do not take these. */
const PLAN_ACTION = /\b(what if|suppose|scenario|approve|send|publish|replan|new version)\b/;
const RESULTS_WORDS = /\b(results?|scorecard|worse|better|baseline|fill rate|cost|ablation|expiry|service level|why)\b/;
const DEMAND_WORDS = /\b(forecast|demand|accuracy|error|seasonal\w*|festival|weather|why)\b/;
/** Common words that must not match a product by accident. */
const SKU_STOP = new Set(["show", "what", "which", "with", "only", "this", "that", "from", "have", "the", "and", "for", "please", "stock", "demand", "results", "plan", "map", "open", "date", "seed", "neutral", "imbalanced"]);

/** Opens another page when the sentence asks for one. Null when the page is already the target. */
export function matchNavigate(text: string, page: Page): Intent | null {
  const m = text.toLowerCase();
  if (!NAV_VERB.test(m)) return null;
  const target = PAGE_WORDS.find(([re]) => re.test(m))?.[1];
  if (!target || target === page) return null;
  return { tool: "navigate", page: target };
}

/** Map only: a depot word sets the lane's start, a distributor city sets its end. */
export function matchSelectLane(text: string, page: Page, refs: ViewRefs): Intent | null {
  if (page !== "map") return null;
  const m = text.toLowerCase();
  const from = refs.places.find((p) => p.type === "depot" && hasWord(m, p.city.toLowerCase()));
  const to = refs.places.find((p) => p.type === "distributor" && hasWord(m, p.city.toLowerCase()));
  if (!from && !to) return null;
  const view: ViewChange = {};
  if (from) view.lane_from = from.node_id;
  if (to) view.lane_to = to.node_id;
  return { tool: "select_lane", view };
}

/** Any page except planning: opening state, place, product, seed and date named in the sentence. */
export function matchSetView(text: string, page: Page, refs: ViewRefs): Intent | null {
  if (page === "planning") return null;
  const m = text.toLowerCase();
  if (ASK.test(m)) return null;
  const view: ViewChange = {};
  if (hasWord(m, "neutral")) view.opening_state = "neutral";
  else if (hasWord(m, "imbalanced")) view.opening_state = "imbalanced";
  const place = refs.places.find((p) => hasWord(m, p.city.toLowerCase()));
  if (place) view.dist_id = place.node_id;
  const sku = findSku(m, refs.skus);
  if (sku) view.sku_id = sku.sku_id;
  const seed = /\bseed\s*([12])\b/.exec(m);
  if (seed) view.seed = Number(seed[1]);
  const date = /\b\d{4}-\d{2}-\d{2}\b/.exec(m)?.[0];
  if (date && isIsoDate(date)) view.as_of = date;
  return Object.keys(view).length ? { tool: "set_view", view } : null;
}

/** A product named in full, or a word of three or more letters that starts a word of the product name. */
function findSku(m: string, skus: ViewRefs["skus"]): ViewRefs["skus"][number] | undefined {
  const full = skus.find((s) => m.includes(s.name.toLowerCase()));
  if (full) return full;
  const words = m.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !SKU_STOP.has(w));
  for (const w of words) {
    const hit = skus.find((s) => s.name.toLowerCase().split(/[^a-z0-9]+/).some((x) => x.startsWith(w)));
    if (hit) return hit;
  }
  return undefined;
}

/** Analysis of the results page (or frontier) and of the demand page. */
export function matchExplain(text: string, page: Page): Intent | null {
  const m = text.toLowerCase();
  if (PLAN_ACTION.test(m)) return null;
  if ((page === "results" || page === "frontier") && RESULTS_WORDS.test(m)) return { tool: "explain_results" };
  if (page === "demand" && DEMAND_WORDS.test(m)) return { tool: "explain_demand" };
  return null;
}

/** Page tools in their fixed order: navigation, lane, filters, then analysis. Null when none applies. */
export function matchView(text: string, page: Page, refs: ViewRefs): Intent | null {
  return matchNavigate(text, page) ?? matchSelectLane(text, page, refs) ?? matchSetView(text, page, refs) ?? matchExplain(text, page);
}

/** Human labels for a filter change, in the order the sidebar reply names them. */
export function describeView(view: ViewChange, refs: ViewRefs): string[] {
  const out: string[] = [];
  if (view.dist_id) out.push(refs.places.find((p) => p.node_id === view.dist_id)?.city ?? view.dist_id);
  if (view.sku_id) out.push(refs.skus.find((s) => s.sku_id === view.sku_id)?.name ?? view.sku_id);
  if (view.opening_state) out.push(view.opening_state === "neutral" ? "Neutral start" : "Imbalanced start");
  if (view.seed !== undefined) out.push(`seed ${view.seed}`);
  if (view.as_of) out.push(`as of ${view.as_of}`);
  return out;
}
