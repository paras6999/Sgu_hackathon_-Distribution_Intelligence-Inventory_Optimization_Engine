/** Typed client for the warehouse routes (/v1/wh/*). Every type comes from @dia/types. */
import type {
  AtRisk, DispatchResponse, Movement, MovementRequest, Scenario, Session, SpaceReport, WhStock, WhUser,
} from "@dia/types";

const TOKEN_KEY = "vitaran.wh.token";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Browser storage can throw (private mode, blocked site data): the app then just asks for login again. */
export function savedToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function saveToken(token: string | null): void {
  try { if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

async function call<T>(method: "GET" | "POST", path: string, token: string | null, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.json().then((j) => (j as { detail?: string }).detail).catch(() => undefined);
    throw new ApiError(r.status, detail ?? r.statusText);
  }
  return r.json() as Promise<T>;
}

export const api = {
  users: () => call<WhUser[]>("GET", "/v1/wh/users", null),
  login: (user_id: string, pin: string) => call<Session>("POST", "/v1/wh/login", null, { user_id, pin }),
  me: (t: string) => call<WhUser>("GET", "/v1/wh/me", t),
  day: (t: string) => call<{ scenario_id: string; as_of: string }>("GET", "/v1/wh/day", t),
  scenario: (id: string) => call<Scenario>("GET", `/v1/scenarios/${encodeURIComponent(id)}`, null),
  space: (t: string) => call<SpaceReport>("GET", "/v1/wh/space", t),
  stock: (t: string, nodeId?: string) => call<WhStock>("GET", `/v1/wh/stock${nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : ""}`, t),
  alerts: (t: string) => call<AtRisk[]>("GET", "/v1/wh/alerts", t),
  loading: (t: string) => call<DispatchResponse[]>("GET", "/v1/wh/loading", t),
  movements: (t: string) => call<Movement[]>("GET", "/v1/wh/movements", t),
  record: (t: string, req: MovementRequest) => call<Movement>("POST", "/v1/wh/movements", t, req),
};
