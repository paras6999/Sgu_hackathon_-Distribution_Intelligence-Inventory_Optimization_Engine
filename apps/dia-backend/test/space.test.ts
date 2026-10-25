/**
 * Warehouse space route on the fake engine, and the rule that display-only assumptions stay out of the experiment id
 * (so stating a new one does not orphan stored runs).
 */
import { beforeEach, describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "@dia/types/schema";
import type { AssumptionRow, SpaceReport } from "@dia/types";
import { createApp, DISPLAY_ONLY_ASSUMPTIONS } from "../src/app";
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

describe("space route (fake engine)", () => {
  test("requires as_of", async () => {
    expect((await call("GET", "/v1/scenarios/seed01/space")).status).toBe(422);
  });

  test("returns a SpaceReport with depot stores and distributor godowns", async () => {
    const r = await call("GET", "/v1/scenarios/seed01/space?as_of=2025-10-13&opening_state=neutral");
    expect(r.status).toBe(200);
    const rep = (await r.json()) as SpaceReport;
    conforms("SpaceReport", rep);
    expect(rep.opening_state).toBe("neutral");
    expect(rep.depots.length).toBeGreaterThan(0);
    expect(rep.distributors.length).toBeGreaterThan(0);
    expect(new Set(rep.depots.map((d) => d.temp_class))).toEqual(new Set(["ambient", "chilled"]));
    for (const n of [...rep.depots, ...rep.distributors]) {
      expect(n.free_m3).toBeCloseTo(Math.max(n.capacity_m3 - n.used_m3, 0), 0);
      for (const f of n.fits) expect(f.cases).toBeGreaterThanOrEqual(0);
    }
  });

  test("defaults to the imbalanced opening state", async () => {
    const rep = (await (await call("GET", "/v1/scenarios/seed01/space?as_of=2025-10-13")).json()) as SpaceReport;
    expect(rep.opening_state).toBe("imbalanced");
  });
});

describe("experiment id", () => {
  /** A fake engine whose assumptions table can grow, to see what changes the experiment id. */
  class GrowingEngine extends FakeEngine {
    extra: AssumptionRow[] = [];
    override async assumptions() { return [...(await super.assumptions()), ...this.extra]; }
  }
  const row = (parameter: string): AssumptionRow => ({ parameter, value: 1, unit: null, source: "judgment", rationale: "test" } as AssumptionRow);
  const idWith = async (extra: AssumptionRow[]) => {
    const engine = new GrowingEngine();
    engine.extra = extra;
    const a = createApp({ repo: new Repo(":memory:"), engine });
    const r = await a.request("/v1/experiments", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    return ((await r.json()) as { experiment_id: string }).experiment_id;
  };

  test("a display-only assumption does not change it", async () => {
    expect(DISPLAY_ONLY_ASSUMPTIONS.has("supply.depot_storage_weeks")).toBe(true);
    expect(await idWith([row("supply.depot_storage_weeks")])).toBe(await idWith([]));
  });

  test("any other new assumption does", async () => {
    expect(await idWith([row("costs.some_new_cost")])).not.toBe(await idWith([]));
  });
});
