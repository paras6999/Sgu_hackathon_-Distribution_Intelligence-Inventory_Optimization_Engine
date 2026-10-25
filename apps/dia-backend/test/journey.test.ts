/**
 * API journey on the fake engine (runs in CI on every PR). The same journey must keep passing once
 * the real engine is wired: plan -> publish -> inbox -> trim -> 409 -> events -> dispatch -> experiment.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "@dia/types/schema";
import type { Plan } from "@dia/types";
import { createApp } from "../src/app";
import { Repo } from "../src/db/repo";
import { FakeEngine } from "../src/engine/fake";

const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
ajv.addSchema(schema);
const conforms = (def: string, data: unknown) => {
  const v = ajv.getSchema(`dia#/$defs/${def}`)!;
  if (!v(data)) throw new Error(`${def}: ${JSON.stringify(v.errors)}`);
};

let app: ReturnType<typeof createApp>;
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
const json = async (r: Response | Promise<Response>): Promise<any> => (await r).json();

beforeEach(() => {
  app = createApp({ repo: new Repo(":memory:"), engine: new FakeEngine() });
});

describe("API journey (fake engine)", () => {
  test("plan, publish, trim, conflict, dispatch, experiment", async () => {
    expect((await json(await call("GET", "/v1/health"))).fake_backend).toBe(true);
    expect((await call("GET", "/v1/scenarios/seed01/snapshot?as_of=2025-10-13")).status).toBe(200);
    expect((await call("POST", "/v1/forecasts", { scenario_id: "seed01", as_of: "2025-10-13" })).status).toBe(200);

    const r = await call("POST", "/v1/plans", { scenario_id: "seed01", as_of: "2025-10-13", temp_class: "ambient" });
    expect(r.status).toBe(200);
    const plan = (await json(r)) as Plan;
    conforms("Plan", plan);
    expect(plan.lines[0]!.line_id.startsWith(`${plan.plan_id}-v1-`)).toBe(true);

    const pub = await json(await call("POST", `/v1/plans/${plan.plan_id}/publish`, { version: 1 }));
    conforms("PublishResponse", pub);
    expect(new Set(pub.messages.map((m: { dist_id: string }) => m.dist_id))).toEqual(new Set(plan.lines.map((l) => l.to_id)));

    const msg = await json(await call("GET", `/v1/plans/${plan.plan_id}/inbox/D01-Pune`));
    conforms("Message", msg);
    const body = { dist_id: "D01-Pune", proposal_version: 1, actions: [{ line_id: msg.line_ids[0], action: "trim", qty: 60 }] };
    const res = await call("POST", `/v1/plans/${plan.plan_id}/responses`, body);
    expect(res.status).toBe(200);
    const result = await json(res);
    conforms("ResponseResult", result);
    expect(result.plan_version).toBe(2);

    expect((await call("POST", `/v1/plans/${plan.plan_id}/responses`, { ...body, proposal_version: 0 })).status).toBe(409);
    expect((await call("POST", `/v1/plans/${plan.plan_id}/responses`, { ...body, actions: [{ line_id: "nope", action: "accept" }] })).status).toBe(422);

    const events = await json(await call("GET", `/v1/plans/${plan.plan_id}/events`));
    expect(events.map((e: { action: string }) => e.action)).toEqual(["publish", "trim"]);

    const d = await json(await call("GET", `/v1/plans/${plan.plan_id}/dispatch?depot=W1-Bhiwandi`));
    conforms("DispatchResponse", d);
    expect(d.trucks.length).toBeGreaterThan(0);
    const csv = await (await call("GET", `/v1/plans/${plan.plan_id}/dispatch.csv`)).arrayBuffer();
    expect([...new Uint8Array(csv).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);

    const ex = await call("POST", "/v1/experiments", {});
    expect(ex.status).toBe(202);
    const { experiment_id } = await json(ex);
    expect((await json(await call("GET", `/v1/experiments/${experiment_id}`))).status).toBe("done");
    conforms("ExperimentResults", await json(await call("GET", `/v1/experiments/${experiment_id}/results`)));

    const rows = await json(await call("GET", "/v1/assumptions"));
    expect(rows.some((x: { parameter: string; source?: string }) => x.parameter === "costs.diesel_inr_per_l" && x.source)).toBe(true);
  });

  test("invalid bodies are rejected with 422", async () => {
    expect((await call("POST", "/v1/plans", { scenario_id: "seed01" })).status).toBe(422);
  });

  test("openapi lists every route", async () => {
    const doc = await json(await call("GET", "/openapi.json"));
    expect(Object.keys(doc.paths).length).toBe(27);
  });
});
