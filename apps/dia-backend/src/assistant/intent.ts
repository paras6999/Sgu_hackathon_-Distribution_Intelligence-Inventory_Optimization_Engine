/**
 * Sidebar assistant intent (owner: M2). Pure: one typed sentence in, one tool name out, no I/O.
 * The tool list is fixed. Numbers in a what-if come only from the sentence, never from a model.
 * Checks run in a fixed order and the first match wins (see parseIntent).
 */
import type { WhatIf } from "@dia/types";

export type Tool =
  | "explain_order"
  | "orders_status"
  | "credit_report"
  | "check_at_risk"
  | "whatif"
  | "publish_plan"
  | "replan"
  | "unknown";

export type Intent = { tool: Tool; dist_id?: string; what_if?: WhatIf };
/** A distributor the sentence can name: its node id and its city. */
export type DistRef = { dist_id: string; city: string };

/** Depot words a user can type, mapped to engine node ids. */
const DEPOTS: Array<[word: string, nodeId: string]> = [
  ["bhiwandi", "W1-Bhiwandi"],
  ["gurugram", "N1-Gurugram"],
  ["hosur", "S1-Hosur"],
  ["dankuni", "E1-Dankuni"],
];
const REGIONS: Array<[word: string, region: "N" | "S" | "E" | "W"]> = [
  ["north", "N"],
  ["south", "S"],
  ["east", "E"],
  ["west", "W"],
];

const PUBLISH = /\b(approve|send|publish|go out|to distributors)\b/;
const REPLAN = /\b(replan|re-plan|new version|regenerate|rebuild)\b/;
const WHATIF = /\b(if|suppose|scenario|diesel|offline|outage|closes?|closed|shut|demand)\b/;
const AT_RISK = /\b(risk|expir\w*)\b/;
const CREDIT_WORDS = /\b(full|limits?|used)\b/;
const EXPLAIN = /\b(why|how|show|order|orders|what)\b/;
const STATUS = /\b(status|how many|summary|overview)\b/;
const OUTAGE = /\b(offline|closes?|closed|outage|down|shut)\b/;
const WEAK_WHATIF = /\b(up|down)\b/;
const DOWN = /\b(down|drop|drops|fall|falls|lower|cut|reduce|decrease|less)\b/;

export function parseIntent(text: string, dists: DistRef[]): Intent {
  const m = text.toLowerCase();
  if (PUBLISH.test(m)) return { tool: "publish_plan" };
  if (REPLAN.test(m)) return { tool: "replan" };
  if (WHATIF.test(m)) return { tool: "whatif", what_if: parseWhatIf(m) };
  if (AT_RISK.test(m)) return { tool: "check_at_risk" };
  if (m.includes("credit") && CREDIT_WORDS.test(m)) return { tool: "credit_report" };
  const dist = dists.find((d) => m.includes(d.city.toLowerCase()) || m.includes(d.dist_id.toLowerCase()));
  if (dist && EXPLAIN.test(m)) return { tool: "explain_order", dist_id: dist.dist_id };
  if (STATUS.test(m)) return { tool: "orders_status" };
  if (WEAK_WHATIF.test(m)) return { tool: "whatif", what_if: parseWhatIf(m) };
  return { tool: "unknown" };
}

/** Scenario changes named in a sentence. Only the keys the sentence sets are present. */
export function parseWhatIf(text: string): WhatIf {
  const m = text.toLowerCase();
  const out: WhatIf = {};
  if (/\bdiesel\b/.test(m)) {
    out.diesel_pct = changeAfter(m, "diesel") ?? (DOWN.test(clauseAfter(m, "diesel")) ? -10 : 10);
  }
  const demand = changeAfter(m, "demand");
  if (demand !== undefined) {
    out.demand_shock_pct = demand;
    const region = REGIONS.find(([word]) => new RegExp(`\\b${word}\\b`).test(m));
    if (region) out.shock_region = region[1];
  }
  const depot = DEPOTS.find(([word]) => new RegExp(`\\b${word}\\b`).test(m));
  if (depot && OUTAGE.test(m)) out.depot_outage_id = depot[1];
  return out;
}

/** The text from a subject word up to the next punctuation mark. Empty when the subject is absent. */
function clauseAfter(m: string, subject: string): string {
  const at = m.search(new RegExp(`\\b${subject}\\b`));
  return at < 0 ? "" : m.slice(at).split(/[.,;!?]/)[0]!;
}

/** Signed percent typed after a subject, e.g. "demand is down 5%" gives -5. Undefined when no percent follows. */
function changeAfter(m: string, subject: string): number | undefined {
  const rest = clauseAfter(m, subject).slice(subject.length);
  const hit = /^([^%\d]*?)(\d+(?:\.\d+)?)\s*(?:%|percent)/.exec(rest);
  if (!hit) return undefined;
  return (DOWN.test(hit[1]!) ? -1 : 1) * Number(hit[2]);
}
