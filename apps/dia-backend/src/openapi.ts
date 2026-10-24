/** OpenAPI 3.1 document for /v1 (owner: M2). Schemas are the shared JSON Schema definitions. */
import schema from "@dia/types/schema";

type Route = { method: "get" | "post"; path: string; summary: string; body?: string; response?: string; array?: boolean; status?: number };

export const ROUTES: Route[] = [
  { method: "get", path: "/v1/health", summary: "Liveness and engine mode" },
  { method: "get", path: "/v1/scenarios", summary: "Scenario ids" },
  { method: "get", path: "/v1/scenarios/{id}", summary: "Nodes (with coordinates), SKUs and lanes", response: "Scenario" },
  { method: "get", path: "/v1/scenarios/{id}/snapshot", summary: "Stock state (query: as_of, opening_state)", response: "Snapshot" },
  { method: "post", path: "/v1/forecasts", summary: "Weekly forecast + backtest metrics", body: "ForecastRequest", response: "ForecastResponse" },
  { method: "post", path: "/v1/plans", summary: "New plan, or new version with base_plan_id", body: "PlanRequest", response: "Plan" },
  { method: "get", path: "/v1/plans/{id}", summary: "Plan (latest version unless ?version=)", response: "Plan" },
  { method: "post", path: "/v1/plans/{id}/publish", summary: "Mark PROPOSED and send proposals", body: "PublishRequest", response: "PublishResponse" },
  { method: "get", path: "/v1/plans/{id}/proposals", summary: "Proposal status per distributor", response: "Proposal", array: true },
  { method: "get", path: "/v1/plans/{id}/inbox/{dist_id}", summary: "One distributor's message", response: "Message" },
  { method: "post", path: "/v1/plans/{id}/responses", summary: "Accept / trim / reject (409 if proposal version is stale)", body: "ResponseRequest", response: "ResponseResult" },
  { method: "get", path: "/v1/plans/{id}/events", summary: "Change log", response: "PlanEvent", array: true },
  { method: "get", path: "/v1/plans/{id}/dispatch", summary: "Truck view, lines in FEFO order (query: depot, version)", response: "DispatchResponse" },
  { method: "get", path: "/v1/plans/{id}/dispatch.csv", summary: "Dispatch sheet CSV (UTF-8 with BOM)" },
  { method: "post", path: "/v1/experiments", summary: "Start evaluation job", body: "ExperimentRequest", response: "ExperimentAccepted", status: 202 },
  { method: "get", path: "/v1/experiments/{id}", summary: "Job status", response: "ExperimentInfo" },
  { method: "get", path: "/v1/experiments/{id}/results", summary: "Cached results (404 until done)", response: "ExperimentResults" },
  { method: "get", path: "/v1/assumptions", summary: "FR-15 assumptions table", response: "AssumptionRow", array: true },
  { method: "get", path: "/v1/ai/status", summary: "Whether an AI model is configured (otherwise rules-based analysis)" },
  { method: "post", path: "/v1/ai/analyse", summary: "Analysis on demand: body {kind: plan|line|results, plan_id | experiment_id, question?}. Figures come from the data; quantities are never set by the model" },
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
