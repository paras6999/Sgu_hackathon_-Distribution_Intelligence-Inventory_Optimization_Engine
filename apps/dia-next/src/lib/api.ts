import type {
  AssistantRequest,
  AssistantResponse,
  AtRisk,
  DispatchResponse,
  OrdersView,
  Plan,
  PlanEvent,
  PlanRequest,
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

export const askAssistant = (body: AssistantRequest) =>
  request<AssistantResponse>("/v1/assistant", { method: "POST", body: JSON.stringify(body) });
