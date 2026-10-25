import type { PolicyName } from "@dia/types";

/** Plain-language names for the screen. Internal ids such as abl_no_expiry never reach the user. */

export const POLICY_NAME = {
  engine: "Engine",
  baseline_a: "Even split",
  baseline_b: "Reorder rule",
} as const;

export type MainPolicy = keyof typeof POLICY_NAME;

export const VARIANT_NAME = {
  abl_no_expiry: "No expiry costs",
  abl_no_truck_steps: "No whole-truck pricing",
  abl_uniform_service: "One service level for every product",
  abl_naive_forecast: "Last year's pattern as the forecast",
  abl_no_credit: "No credit limit",
  abl_home_depot: "Home depot only",
} as const;

/** Name for any policy id, main or variant. */
export const POLICY_LABEL: Record<PolicyName, string> = { ...POLICY_NAME, ...VARIANT_NAME };

export const KPI_NAME = {
  fill_rate: "Demand met",
  festival_fill_rate: "Demand met in festival weeks",
  stockout_rate: "Days out of stock",
  lost_margin_inr: "Margin lost to stockouts",
  wastage_inr: "Stock wasted (expired)",
  freight_inr_per_case: "Freight per case",
  ftl_utilisation: "Truck fill",
  cover_extremes: "Days with too little or too much stock",
  cost_to_serve_inr: "Total cost to serve",
  co2_kg_per_case: "CO₂ per case",
  WAPE: "Forecast error",
  coverage_p10_p90: "Weeks inside the 80% range",
} as const;

export type KpiKey = keyof typeof KPI_NAME;

export const OPENING_NAME = {
  neutral: "Neutral start",
  imbalanced: "Imbalanced start",
} as const;

export const SEASON_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * Line colour per main policy. These are CSS variables, so set them with a style prop
 * (style={{ stroke: POLICY_COLOUR.engine }}). A presentation attribute such as stroke="var(...)" may not resolve.
 */
export const POLICY_COLOUR: Record<MainPolicy, string> = {
  engine: "var(--policy-engine)",
  baseline_a: "var(--policy-a)",
  baseline_b: "var(--policy-b)",
};
