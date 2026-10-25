/**
 * Orders view on the fake engine: one order per proposal, totals equal the sum of the orders, value sort, credit range, 404.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "@dia/types/schema";
import type { OrdersView, Plan } from "@dia/types";
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

async function publishedPlan(): Promise<Plan> {
  const plan = (await json(await call("POST", "/v1/plans", { scenario_id: "seed01", as_of: "2025-10-13", temp_class: "ambient" }))) as Plan;
  await call("POST", `/v1/plans/${plan.plan_id}/publish`, { version: 1 });
  return plan;
}

beforeEach(() => {
  app = createApp({ repo: new Repo(":memory:"), engine: new FakeEngine(), llm: null });
});

describe("orders view (fake engine)", () => {
  test("one order per proposal, for each distributor the plan ships to", async () => {
    const plan = await publishedPlan();
    const view = (await json(await call("GET", `/v1/plans/${plan.plan_id}/orders`))) as OrdersView;
    conforms("OrdersView", view);
    const proposals = await json(await call("GET", `/v1/plans/${plan.plan_id}/proposals`));
    expect(view.orders.map((o) => o.dist_id).sort()).toEqual(proposals.map((p: { dist_id: string }) => p.dist_id).sort());
    expect(new Set(view.orders.map((o) => o.dist_id))).toEqual(new Set(plan.lines.map((l) => l.to_id)));
    expect(view.orders.every((o) => o.cases_since_draft === 0 && o.replied === false)).toBe(true);
    expect(view).toMatchObject({ plan_id: plan.plan_id, version: 1, draft_version: 1, plan_status: "PROPOSED" });
  });

  test("totals equal the sum of the orders", async () => {
    const plan = await publishedPlan();
    const { orders, totals } = (await json(await call("GET", `/v1/plans/${plan.plan_id}/orders`))) as OrdersView;
    const sum = (f: (o: (typeof orders)[number]) => number) => orders.reduce((s, o) => s + f(o), 0);
    expect(totals.orders).toBe(orders.length);
    expect(totals.replied).toBe(0);
    expect(totals.lines).toBe(sum((o) => o.lines));
    expect(totals.cases).toBe(sum((o) => o.cases));
    expect(totals.value_inr).toBeCloseTo(sum((o) => o.value_inr), 6);
    expect(totals.credit_available_inr).toBeCloseTo(sum((o) => o.credit_available_inr), 6);
    expect(totals.draft_lines).toBe(plan.lines.length);
    expect(totals.draft_cases).toBe(plan.lines.reduce((s, l) => s + l.cases, 0));
  });

  test("orders are sorted by value, largest first, and credit use stays within 0 to 100 percent", async () => {
    const plan = await publishedPlan();
    const { orders } = (await json(await call("GET", `/v1/plans/${plan.plan_id}/orders`))) as OrdersView;
    const values = orders.map((o) => o.value_inr);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    for (const o of orders) {
      expect(o.credit_used_pct).toBeGreaterThanOrEqual(0);
      expect(o.credit_used_pct).toBeLessThanOrEqual(100);
    }
  });

  test("a replanned version keeps the draft version for 'since draft'", async () => {
    const plan = await publishedPlan();
    const v2 = (await json(await call("POST", "/v1/plans", {
      scenario_id: "seed01", as_of: "2025-10-13", temp_class: "ambient", base_plan_id: plan.plan_id,
    }))) as Plan;
    const view = (await json(await call("GET", `/v1/plans/${plan.plan_id}/orders`))) as OrdersView;
    expect(view).toMatchObject({ version: 2, draft_version: 1, plan_status: "DRAFT" });
    const older = (await json(await call("GET", `/v1/plans/${plan.plan_id}/orders?version=1`))) as OrdersView;
    expect(older.version).toBe(1);
    expect(v2.version).toBe(2);
  });

  test("unknown plan is 404", async () => {
    expect((await call("GET", "/v1/plans/PL-NOPE00/orders")).status).toBe(404);
  });
});
