/** @dia/types — shared contracts for backend and web. Types are generated; edit schema/*.schema.json instead. */
export * from "./generated";

/** Fixture file -> schema definition it must satisfy. Used by tests and the backend's fake engine. */
export const FIXTURES = {
  scenario: "Scenario",
  snapshot: "Snapshot",
  forecast: "ForecastBundle",
  backtest: "BacktestMetrics",
  targets: "Target[]",
  plan: "Plan",
  results: "ExperimentResults",
  assumptions: "AssumptionRow[]",
} as const;

export type FixtureName = keyof typeof FIXTURES;
