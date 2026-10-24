/** Demand analysis routes on the fake engine: shapes match the shared schema and filters are passed through. */
import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "@dia/types/schema";
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
const app = createApp({ repo: new Repo(":memory:"), engine: new FakeEngine(), llm: null });
const get = async (path: string) => { const r = await app.request(path); return { status: r.status, body: await r.json() as any }; };

test("history conforms to the schema and keeps the selection", async () => {
  const r = await get("/v1/scenarios/seed01/history?dist_id=D05-Delhi&sku_id=SN-01");
  expect(r.status).toBe(200);
  conforms("DemandHistory", r.body);
  expect(r.body).toMatchObject({ dist_id: "D05-Delhi", sku_id: "SN-01", has_band: true });
  expect(r.body.weekly.length).toBeGreaterThan(100);
  expect(r.body.backtest.every((b: any) => b.p10 <= b.p50 && b.p50 <= b.p90)).toBe(true);
});

test("history without a selection is the network and has no band", async () => {
  const r = await get("/v1/scenarios/seed01/history");
  conforms("DemandHistory", r.body);
  expect(r.body).toMatchObject({ dist_id: null, sku_id: null, has_band: false });
});

test("effects and backtest conform to the schema", async () => {
  const e = await get("/v1/scenarios/seed01/effects");
  conforms("LearnedEffects", e.body);
  expect(e.body.festivals.length).toBeGreaterThan(0);
  const b = await get("/v1/scenarios/seed01/backtest");
  conforms("BacktestMetrics", b.body);
});
