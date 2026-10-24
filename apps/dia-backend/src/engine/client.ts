/**
 * Engine client contract (owner: M2). The backend talks to the engine ONLY through this interface.
 * Implementations: FakeEngine (fixtures, ENGINE_MODE=fake) and HttpEngine (engine process, source/binary).
 */
import type {
  AssumptionRow, BacktestMetrics, DemandHistory, EngineForecastRequest, EngineHealth, EnginePlanRequest, EngineResolveRequest,
  ExperimentRequest, ExperimentResults, ForecastBundle, LearnedEffects, OpeningState, Plan, Scenario, Snapshot,
} from "@dia/types";

/** Error carrying the engine's HTTP status (501 not implemented, 404 unknown scenario, 422 invalid plan). */
export class EngineError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(typeof body === "object" && body && "detail" in body ? String((body as { detail: unknown }).detail) : `engine error ${status}`);
  }
}

export type ExperimentOutcome = { status: "done" } | { status: "failed"; error: string };

export interface EngineClient {
  readonly mode: "fake" | "source" | "binary";
  health(): Promise<EngineHealth>;
  scenarios(): Promise<string[]>;
  scenario(id: string): Promise<Scenario>;
  snapshot(id: string, asOf: string, openingState: OpeningState): Promise<Snapshot>;
  forecast(req: EngineForecastRequest): Promise<ForecastBundle>;
  backtest(id: string): Promise<BacktestMetrics>;
  /** Two years of weekly demand with the backtest forecasts, for one distributor and/or SKU (or the whole network). */
  history(id: string, distId?: string, skuId?: string): Promise<DemandHistory>;
  effects(id: string): Promise<LearnedEffects>;
  plan(req: EnginePlanRequest): Promise<Plan>;
  resolve(req: EngineResolveRequest): Promise<Plan>;
  assumptions(): Promise<AssumptionRow[]>;
  /** Runs to completion; calls onProgress with 0..100. */
  runExperiment(id: string, req: ExperimentRequest, onProgress: (pct: number) => void): Promise<ExperimentOutcome>;
  experimentResults(id: string): Promise<ExperimentResults | null>;
  close(): Promise<void>;
}
