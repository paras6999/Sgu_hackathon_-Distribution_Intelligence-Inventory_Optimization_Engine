import type { ReasonCode } from "@dia/types";

/**
 * Lane colours by main reason. MapLibre paint and SVG strokes need literal values, because they cannot read CSS variables.
 * Only the reasons listed here get their own colour. Every other reason uses OTHER_LANE_COLOUR.
 */
export const REASON_COLOUR = {
  CHEAPEST_SOURCE: "#1565c0",
  EXPIRY_PUSH: "#c62828",
  CLIFF_RESCUE: "#8e0000",
  FTL_TOPUP: "#00897b",
  FESTIVAL_UPLIFT: "#e07b00",
  WEATHER_SHIFT: "#039be5",
} as const;

export type ColouredReason = keyof typeof REASON_COLOUR;

export const OTHER_LANE_COLOUR = "#7b8794";

/** Reasons in legend order. */
export const LEGEND_REASONS = Object.keys(REASON_COLOUR) as ColouredReason[];

export function laneColour(reason: ReasonCode | null): string {
  if (reason && reason in REASON_COLOUR) return REASON_COLOUR[reason as ColouredReason];
  return OTHER_LANE_COLOUR;
}
