import type {
  AssistantRequest,
  AssistantResponse,
  AtRisk,
  BacktestMetrics,
  DemandHistory,
  DispatchResponse,
  ExperimentAccepted,
  ExperimentInfo,
  ExperimentRequest,
  ExperimentResults,
  LearnedEffects,
  OpeningState,
  OrdersView,
  Plan,
  PlanEvent,
  PlanRequest,
  ResponseRequest,
  ResponseResult,
  Scenario,
  Trajectory,
} from "@dia/types";

/** An HTTP error from the backend. `message` is the backend's `detail` text when it sent one. */
export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === "object" && "detail" in body) {
      const detail = (body as { detail: unknown }).detail;
      if (typeof detail === "string") return detail;
      return JSON.stringify(detail) ?? `Request failed with status ${res.status}`;
    }
  } catch {
    // The body is not JSON, so fall through to the status message.
  }
  return `Request failed with status ${res.status}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) throw new ApiError(await readErrorMessage(res), res.status);
  return (await res.json()) as T;
}

/** Turns any thrown value into a sentence that can be shown to the user. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return "Could not reach the server.";
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

const enc = encodeURIComponent;

export const getScenarios = () => request<string[]>("/v1/scenarios");

export const createPlan = (body: PlanRequest) =>
  request<Plan>("/v1/plans", { method: "POST", body: JSON.stringify(body) });

export const getPlan = (planId: string) => request<Plan>(`/v1/plans/${enc(planId)}`);

export const getOrders = (planId: string) =>
  request<OrdersView>(`/v1/plans/${enc(planId)}/orders`);

export const getDispatch = (planId: string, depotId: string) =>
  request<DispatchResponse>(`/v1/plans/${enc(planId)}/dispatch?depot=${enc(depotId)}`);

export const getAtRisk = (scenarioId: string, asOf: string) =>
  request<AtRisk[]>(`/v1/scenarios/${enc(scenarioId)}/at-risk?as_of=${enc(asOf)}`);

export const getEvents = (planId: string) =>
  request<PlanEvent[]>(`/v1/plans/${enc(planId)}/events`);

/** Records a distributor reply on an order: accept, trim or reject each line. Triggers a locked re-solve. */
export const respondToOrder = (planId: string, body: ResponseRequest) =>
  request<ResponseResult>(`/v1/plans/${enc(planId)}/responses`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const askAssistant = (body: AssistantRequest) =>
  request<AssistantResponse>("/v1/assistant", { method: "POST", body: JSON.stringify(body) });

/** Adds a query string, skipping keys whose value is undefined or empty. */
function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export const getScenario = (scenarioId: string) =>
  request<Scenario>(`/v1/scenarios/${enc(scenarioId)}`);

export const getHistory = (scenarioId: string, distId?: string, skuId?: string) =>
  request<DemandHistory>(
    withQuery(`/v1/scenarios/${enc(scenarioId)}/history`, { dist_id: distId, sku_id: skuId }),
  );

export const getEffects = (scenarioId: string) =>
  request<LearnedEffects>(`/v1/scenarios/${enc(scenarioId)}/effects`);

export const getBacktest = (scenarioId: string) =>
  request<BacktestMetrics>(`/v1/scenarios/${enc(scenarioId)}/backtest`);

export const startExperiment = (body: ExperimentRequest) =>
  request<ExperimentAccepted>("/v1/experiments", { method: "POST", body: JSON.stringify(body) });

export const getExperiment = (experimentId: string) =>
  request<ExperimentInfo>(`/v1/experiments/${enc(experimentId)}`);

export const getResults = (experimentId: string) =>
  request<ExperimentResults>(`/v1/experiments/${enc(experimentId)}/results`);

export type TrajectoryQuery = {
  sku_id: string;
  dist_id: string;
  opening_state: OpeningState;
  seed: number;
};

export const getTrajectory = (experimentId: string, query: TrajectoryQuery) =>
  request<Trajectory>(
    withQuery(`/v1/experiments/${enc(experimentId)}/trajectory`, {
      sku_id: query.sku_id,
      dist_id: query.dist_id,
      opening_state: query.opening_state,
      seed: query.seed,
    }),
  );
