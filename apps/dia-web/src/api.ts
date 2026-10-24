/** Typed client for the /v1 API (owner: M2). Every type comes from @dia/types, so web and backend can't drift. */
import type {
  AssumptionRow, BacktestMetrics, DemandHistory, DispatchResponse, ExperimentAccepted, ExperimentInfo, ExperimentRequest, ExperimentResults,
  ForecastRequest, ForecastResponse, LearnedEffects, Message, Plan, PlanEvent, PlanRequest, Proposal, PublishResponse,
  ResponseRequest, ResponseResult, Scenario, Snapshot,
} from "@dia/types";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.json().then((j) => j.detail as string).catch(() => r.statusText);
    throw new ApiError(r.status, `${r.status} ${detail}`);
  }
  return r.json() as Promise<T>;
}

export type AiStatus = { enabled: boolean; provider: "vertex" | "gemini" | "rules"; model: string | null; reason: string | null };
export type AnalyseRequest = { kind: "plan" | "line" | "results"; plan_id?: string; version?: number; line_id?: string; experiment_id?: string; opening_state?: string; question?: string };
export type Analysis = { text: string; source: "ai" | "rules"; model: string | null; verified: boolean; unverified_numbers: number[]; note: string | null };

export type Health = { status: string; engine_mode: string; engine: string; fake_backend: boolean };

/** The cached headline run: 10 seeds, both opening states, ablations (a) expiry (b) truck steps (e) service levels. */
export const MAIN_EXPERIMENT: ExperimentRequest = {
  policies: ["engine", "baseline_a", "baseline_b", "abl_no_expiry", "abl_no_truck_steps", "abl_uniform_service"],
  seeds: 10,
  opening_states: ["neutral", "imbalanced"],
};

export const api = {
  health: () => call<Health>("GET", "/v1/health"),
  scenarios: () => call<string[]>("GET", "/v1/scenarios"),
  history: (id: string, dist?: string, sku?: string) => call<DemandHistory>("GET", `/v1/scenarios/${id}/history?${new URLSearchParams({ ...(dist ? { dist_id: dist } : {}), ...(sku ? { sku_id: sku } : {}) })}`),
  effects: (id: string) => call<LearnedEffects>("GET", `/v1/scenarios/${id}/effects`),
  backtest: (id: string) => call<BacktestMetrics>("GET", `/v1/scenarios/${id}/backtest`),
  scenario: (id: string) => call<Scenario>("GET", `/v1/scenarios/${id}`),
  snapshot: (id: string, asOf: string) => call<Snapshot>("GET", `/v1/scenarios/${id}/snapshot?as_of=${asOf}`),
  forecasts: (req: ForecastRequest) => call<ForecastResponse>("POST", "/v1/forecasts", req),
  createPlan: (req: PlanRequest) => call<Plan>("POST", "/v1/plans", req),
  plan: (id: string, version?: number) => call<Plan>("GET", `/v1/plans/${id}${version ? `?version=${version}` : ""}`),
  publish: (id: string, version: number) => call<PublishResponse>("POST", `/v1/plans/${id}/publish`, { version }),
  proposals: (id: string) => call<Proposal[]>("GET", `/v1/plans/${id}/proposals`),
  inbox: (id: string, dist: string) => call<Message>("GET", `/v1/plans/${id}/inbox/${dist}`),
  respond: (id: string, req: ResponseRequest) => call<ResponseResult>("POST", `/v1/plans/${id}/responses`, req),
  events: (id: string) => call<PlanEvent[]>("GET", `/v1/plans/${id}/events`),
  dispatch: (id: string, depot?: string) => call<DispatchResponse>("GET", `/v1/plans/${id}/dispatch${depot ? `?depot=${depot}` : ""}`),
  dispatchCsvUrl: (id: string, depot?: string) => `/v1/plans/${id}/dispatch.csv${depot ? `?depot=${depot}` : ""}`,
  startExperiment: (req: ExperimentRequest = MAIN_EXPERIMENT) => call<ExperimentAccepted>("POST", "/v1/experiments", req),
  experiment: (id: string) => call<ExperimentInfo>("GET", `/v1/experiments/${id}`),
  results: (id: string) => call<ExperimentResults>("GET", `/v1/experiments/${id}/results`),
  assumptions: () => call<AssumptionRow[]>("GET", "/v1/assumptions"),
  aiStatus: () => call<AiStatus>("GET", "/v1/ai/status"),
  analyse: (req: AnalyseRequest) => call<Analysis>("POST", "/v1/ai/analyse", req),
};

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
