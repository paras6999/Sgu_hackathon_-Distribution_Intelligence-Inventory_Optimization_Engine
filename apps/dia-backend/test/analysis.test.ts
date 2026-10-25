/**
 * Analysis routes on the fake engine: at-risk lots, trajectory 404 for unknown experiments, and what-if validation on plans.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "@dia/types/schema";
import type { AtRisk } from "@dia/types";
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

beforeEach(() => {
  app = createApp({ repo: new Repo(":memory:"), engine: new FakeEngine() });
});

describe("analysis routes (fake engine)", () => {
  test("at-risk requires as_of", async () => {
    expect((await call("GET", "/v1/scenarios/seed01/at-risk")).status).toBe(422);
  });

  test("at-risk with as_of returns AtRisk rows", async () => {
    const r = await call("GET", "/v1/scenarios/seed01/at-risk?as_of=2025-10-13");
    expect(r.status).toBe(200);
    const rows = (await r.json()) as AtRisk[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) conforms("AtRisk", row);
  });

  test("trajectory for an unknown experiment is 404", async () => {
    expect((await call("GET", "/v1/experiments/EX-UNKNOWN/trajectory?sku_id=SN-01&dist_id=D01-Pune")).status).toBe(404);
  });

  test("plan accepts a valid what_if and rejects unknown what_if properties", async () => {
    const base = { scenario_id: "seed01", as_of: "2025-10-13", temp_class: "ambient" };
    expect((await call("POST", "/v1/plans", { ...base, what_if: { diesel_pct: 10 } })).status).toBe(200);
    expect((await call("POST", "/v1/plans", { ...base, what_if: { foo: 1 } })).status).toBe(422);
  });
});
