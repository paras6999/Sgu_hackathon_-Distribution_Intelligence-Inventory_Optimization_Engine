/** OpenAPI 3.1 document for /v1 (owner: M2). Schemas are the shared JSON Schema definitions. */
import schema from "@dia/types/schema";

type Route = { method: "get" | "post"; path: string; summary: string; body?: string; response?: string; array?: boolean; status?: number };

export const ROUTES: Route[] = [
  { method: "get", path: "/v1/health", summary: "Liveness and engine mode" },
  { method: "get", path: "/v1/scenarios", summary: "Scenario ids" },
  { method: "get", path: "/v1/scenarios/{id}", summary: "Nodes (with coordinates), SKUs and lanes", response: "Scenario" },
  { method: "get", path: "/v1/scenarios/{id}/history", summary: "Two years of weekly demand with backtest forecasts (query: dist_id, sku_id)", response: "DemandHistory" },
  { method: "get", path: "/v1/scenarios/{id}/effects", summary: "Seasonal, weather and festival effects the forecaster learned", response: "LearnedEffects" },
  { method: "get", path: "/v1/scenarios/{id}/backtest", summary: "Forecast accuracy: WAPE, bias, band coverage", response: "BacktestMetrics" },
  { method: "get", path: "/v1/scenarios/{id}/snapshot", summary: "Stock state (query: as_of, opening_state)", response: "Snapshot" },
  { method: "get", path: "/v1/scenarios/{id}/at-risk", summary: "Distributor lots expected to expire before they sell (query: as_of, opening_state)", response: "AtRisk", array: true },
  { method: "get", path: "/v1/scenarios/{id}/space", summary: "Warehouse space: used and free m3 per depot store and distributor godown, and cases that still fit (query: as_of, opening_state)", response: "SpaceReport" },
  { method: "post", path: "/v1/forecasts", summary: "Weekly forecast + backtest metrics", body: "ForecastRequest", response: "ForecastResponse" },
  { method: "post", path: "/v1/plans", summary: "New plan, or new version with base_plan_id", body: "PlanRequest", response: "Plan" },
  { method: "get", path: "/v1/plans/{id}", summary: "Plan (latest version unless ?version=)", response: "Plan" },
  { method: "post", path: "/v1/plans/{id}/publish", summary: "Mark PROPOSED and send proposals", body: "PublishRequest", response: "PublishResponse" },
  { method: "get", path: "/v1/plans/{id}/orders", summary: "One order per distributor proposal, with totals (query: version)", response: "OrdersView" },
  { method: "get", path: "/v1/plans/{id}/proposals", summary: "Proposal status per distributor", response: "Proposal", array: true },
  { method: "get", path: "/v1/plans/{id}/inbox/{dist_id}", summary: "One distributor's message", response: "Message" },
  { method: "post", path: "/v1/plans/{id}/responses", summary: "Accept / trim / reject (409 if proposal version is stale)", body: "ResponseRequest", response: "ResponseResult" },
  { method: "get", path: "/v1/plans/{id}/events", summary: "Change log", response: "PlanEvent", array: true },
  { method: "get", path: "/v1/plans/{id}/dispatch", summary: "Truck view, lines in FEFO order (query: depot, version)", response: "DispatchResponse" },
  { method: "get", path: "/v1/plans/{id}/dispatch.csv", summary: "Dispatch sheet CSV (UTF-8 with BOM)" },
  { method: "post", path: "/v1/experiments", summary: "Start evaluation job", body: "ExperimentRequest", response: "ExperimentAccepted", status: 202 },
  { method: "get", path: "/v1/experiments/{id}", summary: "Job status", response: "ExperimentInfo" },
  { method: "get", path: "/v1/experiments/{id}/results", summary: "Cached results (404 until done)", response: "ExperimentResults" },
  { method: "get", path: "/v1/experiments/{id}/trajectory", summary: "Day-by-day stock for one SKU and distributor in one seed (query: sku_id, dist_id, opening_state, seed; 404 if no data)", response: "Trajectory" },
  { method: "get", path: "/v1/assumptions", summary: "FR-15 assumptions table", response: "AssumptionRow", array: true },
  { method: "get", path: "/v1/ai/status", summary: "Whether an AI model is configured (otherwise rules-based analysis)" },
  { method: "post", path: "/v1/ai/analyse", summary: "Analysis on demand: body {kind: plan|line|results, plan_id | experiment_id, question?}. Figures come from the data; quantities are never set by the model" },
  { method: "get", path: "/v1/wh/users", summary: "Warehouse app: demo users (planner, one per depot and distributor)", response: "WhUser", array: true },
  { method: "post", path: "/v1/wh/login", summary: "Warehouse app: log in with user_id and PIN; returns a bearer token", body: "LoginRequest", response: "Session" },
  { method: "get", path: "/v1/wh/me", summary: "Warehouse app: the logged-in user (bearer token)", response: "WhUser" },
  { method: "get", path: "/v1/wh/day", summary: "Warehouse app: the scenario and day the app works on (query: as_of)" },
  { method: "get", path: "/v1/wh/space", summary: "Warehouse app: space at the user's stores and the godowns it serves, counted stock applied", response: "SpaceReport" },
  { method: "get", path: "/v1/wh/stock", summary: "Warehouse app: stock by lot at one node, oldest expiry first (query: node_id for planners)", response: "WhStock" },
  { method: "get", path: "/v1/wh/alerts", summary: "Warehouse app: lots at risk of expiry at the user's nodes", response: "AtRisk", array: true },
  { method: "get", path: "/v1/wh/loading", summary: "Warehouse app: trucks of today's sent plans (depot: to load; distributor: coming in)", response: "DispatchResponse", array: true },
  { method: "get", path: "/v1/wh/movements", summary: "Warehouse app: today's receipts, counts and adjustments", response: "Movement", array: true },
  { method: "get", path: "/v1/wh/orders", summary: "Warehouse app: the distributor's orders in today's sent plans (planners: query dist_id)", response: "WhOrder", array: true },
  { method: "post", path: "/v1/wh/orders/respond", summary: "Warehouse app: a distributor accepts, trims or rejects its order lines (same rules as POST /v1/plans/{id}/responses)", body: "WhRespondRequest", response: "ResponseResult" },
  { method: "get", path: "/v1/scenarios/{id}/movements", summary: "What warehouse staff recorded on a day: receipts, counts, adjustments (query: as_of)", response: "Movement", array: true },
  { method: "post", path: "/v1/wh/movements", summary: "Warehouse app: record a receipt, count or adjustment (own node only)", body: "MovementRequest", response: "Movement", status: 201 },
  { method: "post", path: "/v1/assistant", summary: "Sidebar assistant: one sentence runs one fixed tool (status, explain, credit, at-risk, what-if, approve and send, replan)", body: "AssistantRequest", response: "AssistantResponse" },
];

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

export function openapiDocument() {
  const defs = JSON.parse(JSON.stringify((schema as { $defs: object }).$defs).replaceAll("#/$defs/", "#/components/schemas/"));
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of ROUTES) {
    const params = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    const content = r.response
      ? { "application/json": { schema: r.array ? { type: "array", items: ref(r.response) } : ref(r.response) } }
      : undefined;
    paths[r.path] ??= {};
    paths[r.path]![r.method] = {
      summary: r.summary,
      parameters: params,
      ...(r.body ? { requestBody: { required: true, content: { "application/json": { schema: ref(r.body) } } } } : {}),
      responses: { [String(r.status ?? 200)]: { description: "OK", ...(content ? { content } : {}) } },
    };
  }
  return { openapi: "3.1.0", info: { title: "Vitaran (DIAgent) API", version: "1.1" }, paths, components: { schemas: defs } };
}

export const DOCS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Vitaran API</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css"></head>
<body><div id="ui"></div><script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>
<script>SwaggerUIBundle({ url: "/openapi.json", dom_id: "#ui" });</script></body></html>`;
