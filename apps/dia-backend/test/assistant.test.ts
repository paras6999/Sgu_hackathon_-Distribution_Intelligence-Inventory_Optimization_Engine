/**
 * Sidebar assistant: intent parsing (pure function) and POST /v1/assistant on the fake engine.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { AssistantResponse, Plan } from "@dia/types";
import { createApp } from "../src/app";
import { findSku, parseIntent, parseWhatIf, type DistRef, type Intent } from "../src/assistant/intent";
import { Repo } from "../src/db/repo";
import { FakeEngine } from "../src/engine/fake";

const DISTS: DistRef[] = [
  { dist_id: "D01-Pune", city: "Pune" },
  { dist_id: "D09-Bengaluru", city: "Bengaluru" },
];

describe("intent parsing (pure)", () => {
  const CASES: Array<[string, Intent]> = [
    ["What is the status of this plan?", { tool: "orders_status" }],
    ["How many orders are there?", { tool: "orders_status" }],
    ["Why is the Pune order so big?", { tool: "explain_order", dist_id: "D01-Pune" }],
    ["Which distributors are near their credit limit?", { tool: "credit_report" }],
    ["Any stock expiring soon?", { tool: "check_at_risk" }],
    ["Approve and send the plan", { tool: "publish_plan" }],
    ["Replan with the latest data", { tool: "replan" }],
    ["Tell me a joke", { tool: "unknown" }],
  ];
  test.each(CASES)("%s", (message, expected) => {
    expect(parseIntent(message, DISTS)).toEqual(expected);
  });

  test("diesel change is read from the sentence, default 10 when no number is typed", () => {
    expect(parseIntent("What if diesel goes up 15%?", DISTS)).toEqual({ tool: "whatif", what_if: { diesel_pct: 15 } });
    expect(parseWhatIf("What if diesel goes up")).toEqual({ diesel_pct: 10 });
  });

  test("depot outage maps the depot word to its node id", () => {
    expect(parseIntent("Bhiwandi depot goes offline", DISTS)).toEqual({ tool: "whatif", what_if: { depot_outage_id: "W1-Bhiwandi" } });
  });

  test("a question no action tool covers goes to answer_question", () => {
    expect(parseIntent("What is the total freight cost?", DISTS)).toEqual({ tool: "answer_question" });
    expect(parseIntent("which lanes use part-truck loads", DISTS)).toEqual({ tool: "answer_question" });
    // action and lookup tools still win over the generic question
    expect(parseIntent("What if diesel goes up 10%?", DISTS).tool).toBe("whatif");
    expect(parseIntent("What is the status of this plan?", DISTS).tool).toBe("orders_status");
  });

  test("a named product is picked up from the words of its catalogue name", () => {
    const skus = [{ sku_id: "ST-01", name: "Whole Wheat Atta 5 kg" }, { sku_id: "SN-01", name: "Masala Chips 52 g" }, { sku_id: "SN-02", name: "Aloo Bhujia 200 g" }];
    expect(findSku("why is pune getting so much atta", skus)).toBe("ST-01");
    expect(findSku("masala chips for pune", skus)).toBe("SN-01");
    expect(findSku("how is pune doing", skus)).toBeUndefined();
    expect(parseIntent("Why is Pune getting so much atta?", DISTS, skus)).toEqual({ tool: "explain_order", dist_id: "D01-Pune", sku_id: "ST-01" });
  });

  test("demand change takes sign and region from the words", () => {
    expect(parseWhatIf("Suppose demand in the north rises 20%")).toEqual({ demand_shock_pct: 20, shock_region: "N" });
    expect(parseWhatIf("Demand down 5% in the south")).toEqual({ demand_shock_pct: -5, shock_region: "S" });
  });
});

let app: ReturnType<typeof createApp>;
const call = (method: string, path: string, body?: unknown) =>
  app.request(path, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
const json = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
const ask = (plan_id: string, message: string, extra: Record<string, unknown> = {}): Promise<AssistantResponse> =>
  json(call("POST", "/v1/assistant", { plan_id, message, ...extra }));

async function newPlan(): Promise<Plan> {
  return (await json(await call("POST", "/v1/plans", { scenario_id: "seed01", as_of: "2025-10-13", temp_class: "ambient" }))) as Plan;
}

beforeEach(() => {
  app = createApp({ repo: new Repo(":memory:"), engine: new FakeEngine(), llm: null });
});

describe("POST /v1/assistant (fake engine)", () => {
  test("unknown message is answered with intent unknown", async () => {
    const plan = await newPlan();
    const r = await ask(plan.plan_id, "Tell me a joke");
    expect(r).toMatchObject({ status: "answered", intent: "unknown", steps: [], plan_id: plan.plan_id, plan_version: 1, source: "rules" });
    expect(r.reply.length).toBeLessThan(400);
  });

  test("publish in ask_first without confirm waits and leaves the plan unchanged", async () => {
    const plan = await newPlan();
    const distCount = new Set(plan.lines.map((l) => l.to_id)).size;
    const r = await ask(plan.plan_id, "Approve and send the orders", { mode: "ask_first" });
    expect(r).toMatchObject({ status: "needs_confirmation", intent: "publish_plan", pending_action: "publish_plan", steps: [], plan_status: "DRAFT" });
    expect(r.reply).toBe(`Ready to approve and send ${distCount} orders. Confirm to continue.`);
    expect((await json(await call("GET", `/v1/plans/${plan.plan_id}`))).status).toBe("DRAFT");
    expect(await json(await call("GET", `/v1/plans/${plan.plan_id}/proposals`))).toEqual([]);
  });

  test("publish with confirm sends the orders", async () => {
    const plan = await newPlan();
    const distCount = new Set(plan.lines.map((l) => l.to_id)).size;
    const r = await ask(plan.plan_id, "Approve and send the orders", { mode: "ask_first", confirm: true });
    expect(r).toMatchObject({ status: "completed", intent: "publish_plan", plan_status: "PROPOSED", pending_action: null });
    expect(r.reply).toBe(`Sent ${distCount} orders to distributors.`);
    expect(r.steps).toEqual([expect.objectContaining({ tool: "publish_plan", status: "done" })]);
  });

  test("what-if runs a new plan in ask_first mode and leaves the current plan alone", async () => {
    const plan = await newPlan();
    const r = await ask(plan.plan_id, "What if diesel goes up 10%?", { mode: "ask_first" });
    expect(r).toMatchObject({ status: "completed", intent: "whatif", plan_id: plan.plan_id, plan_version: 1 });
    const step = r.steps[0]!;
    expect(step).toMatchObject({ tool: "whatif", status: "done" });
    expect(step.plan_id).not.toBe(plan.plan_id);
    expect((await call("GET", `/v1/plans/${step.plan_id}`)).status).toBe(200);
    expect((await json(await call("GET", `/v1/plans/${plan.plan_id}`))).plan_id).toBe(plan.plan_id);
  });

  test("status and explain answer from the published orders", async () => {
    const plan = await newPlan();
    await call("POST", `/v1/plans/${plan.plan_id}/publish`, { version: 1 });
    const status = await ask(plan.plan_id, "How many orders are there?");
    expect(status).toMatchObject({ status: "answered", intent: "orders_status" });
    expect(status.reply).toMatch(/^3 orders, 0 replied, 4 lines, 770 cases, Rs \d+\.\d{2} crore\.$/);
    const explain = await ask(plan.plan_id, "Why is the Pune order so big?");
    expect(explain).toMatchObject({ status: "answered", intent: "explain_order" });
    expect(explain.reply).toMatch(/^Pune: 2 lines, 520 cases, Rs \d+\.\d{2} lakh of Rs \d+\.\d{2} lakh credit \(\d+(\.\d)?% used\), no change from the draft\.$/);
  });

  test("explain with a product lists that product's lines and their reasons", async () => {
    const plan = await newPlan();
    await call("POST", `/v1/plans/${plan.plan_id}/publish`, { version: 1 });
    const r = await ask(plan.plan_id, "Why is Pune getting masala chips?");
    expect(r).toMatchObject({ status: "answered", intent: "explain_order" });
    expect(r.reply).toStartWith("Pune gets 120 cases of Masala Chips 50 g: 120 from");
    expect(r.reply).toContain("Diwali x1.38");
  });

  test("a general question is answered from the plan's facts (rules summary without a model)", async () => {
    const plan = await newPlan();
    const r = await ask(plan.plan_id, "What is the total freight cost?");
    expect(r).toMatchObject({ status: "answered", intent: "answer_question", source: "rules" });
    expect(r.steps).toEqual([expect.objectContaining({ tool: "answer_question", status: "done" })]);
    expect(r.reply).toContain("Summary:");
  });

  test("a general question uses the model's verified analysis when one is configured", async () => {
    const llm = { name: "mock", model: "mock-1", async generate() { return "Freight is the smaller part of cost to serve here."; } };
    app = createApp({ repo: new Repo(":memory:"), engine: new FakeEngine(), llm });
    const plan = await newPlan();
    const r = await ask(plan.plan_id, "What is the total freight cost?");
    expect(r).toMatchObject({ status: "answered", intent: "answer_question", source: "ai", reply: "Freight is the smaller part of cost to serve here." });
    expect(r.steps[0]!.summary).toBe("Answered from plan facts, every figure checked");
  });

  test("stock at risk reports the stock and the advice, not expected expired cases", async () => {
    const plan = await newPlan();
    const r = await ask(plan.plan_id, "Any stock expiring soon?");
    expect(r).toMatchObject({ status: "answered", intent: "check_at_risk" });
    expect(r.reply).toMatch(/lots at risk of expiry\. .+: \d[\d,]* cases, -?\d+ days left, /);
    expect(r.reply).not.toContain("ships within days");
  });
});
