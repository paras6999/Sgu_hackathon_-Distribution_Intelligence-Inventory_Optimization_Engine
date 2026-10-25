import type { KpiSummary, OpeningState, PolicyName } from "@dia/types";
import { formatNumber, formatPercent, formatRupees } from "@/lib/format";
import { KPI_NAME, POLICY_COLOUR, type MainPolicy } from "@/lib/names";

/**
 * Logic for the Results and Frontier pages. Numbers come from the stored experiment; this file only
 * formats them and applies the target rules from the design (PRD 8.2).
 */

/** How a KPI value is shown. Rates are fractions (0.95 means 95%). */
export type KpiFormat = "pct" | "inr" | "kg";

export type KpiMeta = { fmt: KpiFormat; higherBetter: boolean };

export const KPI_META: Record<string, KpiMeta> = {
  fill_rate: { fmt: "pct", higherBetter: true },
  festival_fill_rate: { fmt: "pct", higherBetter: true },
  stockout_rate: { fmt: "pct", higherBetter: false },
  lost_margin_inr: { fmt: "inr", higherBetter: false },
  wastage_inr: { fmt: "inr", higherBetter: false },
  freight_inr_per_case: { fmt: "inr", higherBetter: false },
  ftl_utilisation: { fmt: "pct", higherBetter: true },
  cost_to_serve_inr: { fmt: "inr", higherBetter: false },
  cover_extremes: { fmt: "pct", higherBetter: false },
  co2_kg_per_case: { fmt: "kg", higherBetter: false },
};

export const KPI_ORDER = Object.keys(KPI_META);

/** The four figures in the Results strip, with the labels the design uses. */
export const HEADLINE: { kpi: string; label: string }[] = [
  { kpi: "cost_to_serve_inr", label: "Total cost to serve" },
  { kpi: "fill_rate", label: "Demand met" },
  { kpi: "wastage_inr", label: "Stock wasted" },
  { kpi: "freight_inr_per_case", label: "Freight per case" },
];

export function kpiLabel(kpi: string): string {
  return (KPI_NAME as Record<string, string>)[kpi] ?? kpi;
}

export function metaOf(kpi: string): KpiMeta {
  return KPI_META[kpi] ?? { fmt: "inr", higherBetter: false };
}

/** A KPI value for the screen, for example 95.4% or ₹19.70 lakh. */
export function formatKpi(value: number, fmt: KpiFormat): string {
  if (!Number.isFinite(value)) return "–";
  if (fmt === "pct") return formatPercent(value * 100);
  if (fmt === "inr") return formatRupees(value);
  return `${value.toFixed(2)} kg`;
}

/** A signed change for the screen. Rates change in points, so 0.02 shows as +2.0 points. */
export function formatKpiChange(value: number, fmt: KpiFormat): string {
  if (!Number.isFinite(value)) return "–";
  if (fmt === "pct") return formatPoints(value * 100);
  if (fmt === "inr") return formatRupees(value, true);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)} kg`;
}

/** Points already multiplied by 100, such as 1.25 → "+1.3 points". */
export function formatPoints(points: number): string {
  if (!Number.isFinite(points)) return "–";
  const sign = points > 0 ? "+" : points < 0 ? "-" : "";
  return `${sign}${Math.abs(points).toFixed(1)} points`;
}

/** A relative change against a base value, for example "-15%". Empty when the base is zero. */
export function formatRelative(delta: number, base: number): string {
  if (!Number.isFinite(delta) || !Number.isFinite(base) || base === 0) return "";
  const pct = (delta / Math.abs(base)) * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "-" : "";
  return `${sign}${formatNumber(Math.round(Math.abs(pct)))}%`;
}

/** The better of Even split and Reorder rule for one KPI, derived from the engine's stored difference. */
export function bestPolicyValue(engine: KpiSummary): number | null {
  if (engine.delta_vs_best_baseline == null) return null;
  return engine.mean - engine.delta_vs_best_baseline;
}

export function findKpi(rows: KpiSummary[], kpi: string, policy: PolicyName): KpiSummary | undefined {
  return rows.find((row) => row.kpi === kpi && row.policy === policy);
}

/** True when the engine is worse than the better policy and the 90% range is on the wrong side of zero. */
export function engineIsWorse(kpi: string, engine: KpiSummary): boolean {
  if (engine.delta_vs_best_baseline == null) return false;
  return metaOf(kpi).higherBetter ? (engine.delta_ci_high ?? 0) < 0 : (engine.delta_ci_low ?? 0) > 0;
}

/** Whether a difference is an improvement for the engine. Zero is neither. */
export function changeTone(kpi: string, delta: number | null | undefined): "good" | "bad" | "flat" {
  if (delta == null || delta === 0) return "flat";
  const better = metaOf(kpi).higherBetter ? delta > 0 : delta < 0;
  return better ? "good" : "bad";
}

export function policyColour(policy: PolicyName): string {
  return policy in POLICY_COLOUR ? POLICY_COLOUR[policy as MainPolicy] : "var(--muted)";
}

/** Target rules from PRD 8.2. `met` gets the engine's row and the better policy's mean. */
export interface Target {
  text: string;
  met: (k: KpiSummary, best: number) => boolean;
}

export function targetFor(kpi: string, state: OpeningState): Target | null {
  const imbalanced = state === "imbalanced";
  const relative = (cut: number) => (k: KpiSummary, best: number) =>
    !!k.delta_vs_best_baseline && k.delta_vs_best_baseline / best <= -cut && (k.delta_ci_high ?? 1) < 0;
  switch (kpi) {
    case "fill_rate": {
      const pts = imbalanced ? 0.04 : 0.02;
      return {
        text: `≥ +${Math.round(pts * 100)} points`,
        met: (k) => !!k.delta_vs_best_baseline && k.delta_vs_best_baseline >= pts && (k.delta_ci_low ?? -1) > 0,
      };
    }
    case "stockout_rate": {
      const cut = imbalanced ? 0.3 : 0.2;
      return { text: `≤ -${Math.round(cut * 100)}%`, met: relative(cut) };
    }
    case "lost_margin_inr": {
      const cut = imbalanced ? 0.3 : 0.2;
      return { text: `≤ -${Math.round(cut * 100)}%`, met: relative(cut) };
    }
    case "wastage_inr": {
      const cut = imbalanced ? 0.35 : 0.2;
      return { text: `≤ -${Math.round(cut * 100)}%`, met: relative(cut) };
    }
    case "freight_inr_per_case":
      return {
        text: "≤ +5%",
        met: (k, best) => !!k.delta_vs_best_baseline && k.delta_vs_best_baseline / best <= 0.05,
      };
    case "ftl_utilisation":
      return { text: "≥ 85%", met: (k) => k.mean >= 0.85 };
    case "cost_to_serve_inr": {
      const cut = imbalanced ? 0.15 : 0.08;
      return { text: `≤ -${Math.round(cut * 100)}%`, met: relative(cut) };
    }
    case "cover_extremes": {
      const cut = imbalanced ? 0.4 : 0.25;
      return { text: `≤ -${Math.round(cut * 100)}%`, met: relative(cut) };
    }
    case "co2_kg_per_case":
      return {
        text: "≤ the better policy",
        met: (k) => !!k.delta_vs_best_baseline && k.delta_vs_best_baseline <= 0,
      };
    default:
      return null;
  }
}

/** Why the engine trades a KPI away. Shown under "Where the engine is worse, and why". */
export const WORSENS_CAUSE: Record<string, string> = {
  fill_rate:
    "The engine ships a case only when the expected lost margin beats freight, holding and expiry cost. On thin, low-margin lanes it accepts a few more stockouts instead of sending part-empty trucks.",
  festival_fill_rate:
    "Same trade-off, sharper in the festival run-up, when forecast error is larger and extra stock is dearer to carry.",
  stockout_rate: "Fewer, fuller trucks mean slimmer safety stock on slow SKUs.",
  lost_margin_inr: "The margin given up on the extra stockouts; it is far smaller than the freight and wastage saved.",
  cover_extremes: "Tighter cover also means more days with a SKU at zero stock.",
};

/** Frontier knobs: the parameter each policy sweeps, its plain name, and the default setting. */
export const KNOB_NAME: Record<string, string> = {
  pi_mult: "stockout weight",
  service_level: "service level",
  cover_days: "days of cover",
};

export const DEFAULT_KNOB: Record<string, number> = {
  pi_mult: 1,
  service_level: 0.95,
  cover_days: 14,
};

export function isDefaultKnob(param: string, value: number): boolean {
  const base = DEFAULT_KNOB[param];
  return base !== undefined && Math.abs(base - value) < 1e-9;
}

/** The knob value as the table and chart show it: ×1, 95%, or 14 days. */
export function knobLabel(param: string, value: number): string {
  if (param === "pi_mult") return `×${value}`;
  if (param === "service_level") return `${Number((value * 100).toFixed(1))}%`;
  if (param === "cover_days") return `${value} days`;
  return String(value);
}
