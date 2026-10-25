/**
 * Warehouse app routes on the fake engine: login, scoping by role, stock movements, and counts reaching the engine.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import type { EnginePlanRequest, Movement, Session, SpaceReport, WhOrder, WhStock, WhUser } from "@dia/types";
import { createApp } from "../src/app";
import { Repo } from "../src/db/repo";
import { FakeEngine } from "../src/engine/fake";
import { env } from "../src/env";

/** Records what the backend sends to the engine when it makes a plan. */
class SpyEngine extends FakeEngine {
  planned: EnginePlanRequest[] = [];
  override async plan(req: EnginePlanRequest) { this.planned.push(req); return super.plan(req); }
}

let app: ReturnType<typeof createApp>;
let engine: SpyEngine;
const call = (method: string, path: string, body?: unknown, token?: string) =>
  app.request(path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const json = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
const login = async (user_id: string) => ((await json(call("POST", "/v1/wh/login", { user_id, pin: env.whDemoPin }))) as Session).token;

beforeEach(() => {
  engine = new SpyEngine();
  app = createApp({ repo: new Repo(":memory:"), engine, llm: null });
});

describe("login", () => {
  test("users are a planner plus one per depot and distributor", async () => {
    const users = (await json(call("GET", "/v1/wh/users"))) as WhUser[];
    expect(users[0]).toEqual({ user_id: "planner", name: "Supply planner", role: "planner", node_id: null });
    expect(users).toContainEqual({ user_id: "d01-pune", name: "Pune distributor", role: "distributor", node_id: "D01-Pune" });
    expect(users).toContainEqual({ user_id: "w1-bhiwandi", name: "Bhiwandi depot", role: "depot", node_id: "W1-Bhiwandi" });
  });

  test("the right PIN gives a token; a wrong one or no token is refused", async () => {
    const ok = await call("POST", "/v1/wh/login", { user_id: "D01-Pune", pin: env.whDemoPin });
    expect(ok.status).toBe(200);
    const s = (await ok.json()) as Session;
    expect(s.user.node_id).toBe("D01-Pune");
    expect((await call("POST", "/v1/wh/login", { user_id: "d01-pune", pin: `${env.whDemoPin}x` })).status).toBe(401);
    expect((await call("GET", "/v1/wh/me")).status).toBe(401);
    expect(await json(call("GET", "/v1/wh/me", undefined, s.token))).toEqual(s.user);
  });
});

describe("scoping", () => {
  test("a distributor sees only its own godown; a depot sees its stores and the godowns it serves", async () => {
    const dist = (await json(call("GET", "/v1/wh/space", undefined, await login("d01-pune")))) as SpaceReport;
    expect(dist.depots).toEqual([]);
    expect(dist.distributors.map((n) => n.node_id)).toEqual(["D01-Pune"]);
    const depot = (await json(call("GET", "/v1/wh/space", undefined, await login("s1-hosur")))) as SpaceReport;
    expect(new Set(depot.depots.map((n) => n.node_id))).toEqual(new Set(["S1-Hosur"]));
    expect(depot.distributors.map((n) => n.node_id).sort()).toEqual(["D09-Bengaluru", "D10-Coimbatore"]);
    const planner = (await json(call("GET", "/v1/wh/space", undefined, await login("planner")))) as SpaceReport;
    expect(planner.distributors.length).toBe(3);
  });

  test("a distributor cannot read or change another node", async () => {
    const t = await login("d01-pune");
    expect((await call("GET", "/v1/wh/stock?node_id=D09-Bengaluru", undefined, t)).status).toBe(403);
    expect((await call("POST", "/v1/wh/movements", { kind: "count", node_id: "D09-Bengaluru", sku_id: "SN-01", cases: 5 }, t)).status).toBe(403);
  });
});

describe("movements and counts", () => {
  test("a count replaces the stock shown and reaches the engine when a plan is made", async () => {
    const t = await login("d01-pune");
    const r = await call("POST", "/v1/wh/movements", { kind: "count", node_id: "D01-Pune", sku_id: "SN-01", cases: 7, as_of: "2025-10-13" }, t);
    expect(r.status).toBe(201);
    expect(((await r.json()) as Movement)).toMatchObject({ kind: "count", sku_name: "Masala Chips 50 g", cases: 7, user_id: "d01-pune" });
    const stock = (await json(call("GET", "/v1/wh/stock?as_of=2025-10-13", undefined, t))) as WhStock;
    expect(stock.rows.filter((x) => x.sku_id === "SN-01" && x.state !== "in_transit")).toEqual([
      expect.objectContaining({ sku_id: "SN-01", cases: 7, state: "counted" }),
    ]);
    await call("POST", "/v1/plans", { scenario_id: "seed01", as_of: "2025-10-13", temp_class: "ambient" });
    expect(engine.planned.at(-1)!.stock_counts).toEqual([{ node_id: "D01-Pune", sku_id: "SN-01", cases: 7 }]);
  });

  test("an adjustment moves the counted figure and never below zero", async () => {
    const t = await login("planner");
    await call("POST", "/v1/wh/movements", { kind: "count", node_id: "D09-Bengaluru", sku_id: "SN-01", cases: 20, as_of: "2025-10-13" }, t);
    await call("POST", "/v1/wh/movements", { kind: "adjust", node_id: "D09-Bengaluru", sku_id: "SN-01", cases: -6, reason: "damaged", as_of: "2025-10-13" }, t);
    await call("POST", "/v1/wh/movements", { kind: "adjust", node_id: "D10-Coimbatore", sku_id: "SN-01", cases: -99999, as_of: "2025-10-13" }, t);
    const moves = (await json(call("GET", "/v1/wh/movements?as_of=2025-10-13", undefined, t))) as Movement[];
    expect(moves.map((m) => m.kind)).toEqual(["adjust", "adjust", "count"]);
    await call("POST", "/v1/plans", { scenario_id: "seed01", as_of: "2025-10-13", temp_class: "ambient" });
    expect(engine.planned.at(-1)!.stock_counts).toEqual([
      { node_id: "D09-Bengaluru", sku_id: "SN-01", cases: 14 },
      { node_id: "D10-Coimbatore", sku_id: "SN-01", cases: 0 },
    ]);
  });

  test("a negative receipt or count is rejected", async () => {
    const t = await login("d01-pune");
    expect((await call("POST", "/v1/wh/movements", { kind: "receipt", node_id: "D01-Pune", sku_id: "SN-01", cases: -1 }, t)).status).toBe(422);
  });
});

describe("web and app together", () => {
  test("the planner sends, the distributor answers in the app, and the planner's view shows the reply", async () => {
    const plan = await json(call("POST", "/v1/plans", { scenario_id: "seed01", as_of: "2025-10-13", temp_class: "ambient" }));
    const t = await login("d01-pune");
    expect(await json(call("GET", "/v1/wh/orders?as_of=2025-10-13", undefined, t))).toEqual([]);      // nothing until it is sent
    await call("POST", `/v1/plans/${plan.plan_id}/publish`, { version: plan.version });
    const orders = (await json(call("GET", "/v1/wh/orders?as_of=2025-10-13", undefined, t))) as WhOrder[];
    expect(orders.length).toBe(1);
    const o = orders[0]!;
    expect(o).toMatchObject({ plan_id: plan.plan_id, dist_id: "D01-Pune", proposal_version: 1, replied: false });
    expect(o.lines.every((l) => l.to_id === "D01-Pune")).toBe(true);
    const r = await call("POST", "/v1/wh/orders/respond", { plan_id: o.plan_id, proposal_version: o.proposal_version, actions: o.lines.map((l) => ({ line_id: l.line_id, action: "accept" })) }, t);
    expect(r.status).toBe(200);
    const props = await json(call("GET", `/v1/plans/${plan.plan_id}/proposals`));
    expect(props.find((p: { dist_id: string }) => p.dist_id === "D01-Pune").responded_at).not.toBeNull();
    const again = (await json(call("GET", "/v1/wh/orders?as_of=2025-10-13", undefined, t))) as WhOrder[];
    expect(again[0]!.replied).toBe(true);
    // an answer on a proposal version that is not current is refused, exactly as on the planner's screen
    const stale = await call("POST", "/v1/wh/orders/respond", { plan_id: o.plan_id, proposal_version: o.proposal_version + 1, actions: [{ line_id: o.lines[0]!.line_id, action: "reject" }] }, t);
    expect(stale.status).toBe(409);
  });

  test("the app follows the latest sent plan, not a later draft or what-if", async () => {
    const t = await login("d01-pune");
    const sent = await json(call("POST", "/v1/plans", { scenario_id: "seed01", as_of: "2025-10-13", temp_class: "ambient" }));
    await call("POST", `/v1/plans/${sent.plan_id}/publish`, { version: sent.version });
    await call("POST", "/v1/plans", { scenario_id: "seed01", as_of: "2025-10-20", temp_class: "ambient" });      // a later draft
    expect(await json(call("GET", "/v1/wh/day", undefined, t))).toEqual({ scenario_id: "seed01", as_of: "2025-10-13" });
    expect(((await json(call("GET", "/v1/wh/orders", undefined, t))) as WhOrder[]).map((o) => o.plan_id)).toEqual([sent.plan_id]);
  });

  test("only a distributor answers, and only its own order", async () => {
    const plan = await json(call("POST", "/v1/plans", { scenario_id: "seed01", as_of: "2025-10-13", temp_class: "ambient" }));
    await call("POST", `/v1/plans/${plan.plan_id}/publish`, { version: plan.version });
    const body = { plan_id: plan.plan_id, proposal_version: 1, actions: [{ line_id: plan.lines[0].line_id, action: "accept" }] };
    expect((await call("POST", "/v1/wh/orders/respond", body, await login("w1-bhiwandi"))).status).toBe(403);
    expect((await call("GET", "/v1/wh/orders?as_of=2025-10-13&dist_id=D09-Bengaluru", undefined, await login("d01-pune"))).status).toBe(200);
    const theirs = await json(call("GET", "/v1/wh/orders?as_of=2025-10-13", undefined, await login("d01-pune"))) as WhOrder[];
    expect(theirs.every((o) => o.dist_id === "D01-Pune")).toBe(true);
  });

  test("the planner's web feed lists what warehouse staff recorded", async () => {
    await call("POST", "/v1/wh/movements", { kind: "receipt", node_id: "D01-Pune", sku_id: "SN-01", cases: 120, as_of: "2025-10-13" }, await login("d01-pune"));
    const feed = (await json(call("GET", "/v1/scenarios/seed01/movements?as_of=2025-10-13"))) as Movement[];
    expect(feed).toEqual([expect.objectContaining({ kind: "receipt", node_id: "D01-Pune", cases: 120 })]);
    expect((await call("GET", "/v1/scenarios/seed01/movements")).status).toBe(422);
  });
});

describe("loading", () => {
  test("only sent plans reach the loading list; drafts and what-ifs do not", async () => {
    await call("POST", "/v1/plans", { scenario_id: "seed01", as_of: "2025-10-13", temp_class: "ambient" });
    expect(await json(call("GET", "/v1/wh/loading?as_of=2025-10-13", undefined, await login("planner")))).toEqual([]);
  });

  test("a depot sees the trucks it loads today; a distributor sees the trucks coming to it", async () => {
    const plan = await json(call("POST", "/v1/plans", { scenario_id: "seed01", as_of: "2025-10-13", temp_class: "ambient" }));
    await call("POST", `/v1/plans/${plan.plan_id}/publish`, { version: plan.version });
    const fromDepot = new Set(plan.trucks.map((x: { from_id: string }) => x.from_id));
    const depotId = [...fromDepot][0] as string;
    const depot = await json(call("GET", "/v1/wh/loading?as_of=2025-10-13", undefined, await login(depotId.toLowerCase())));
    expect(depot.length).toBe(1);
    expect(depot[0].trucks.every((t: { truck: { from_id: string } }) => t.truck.from_id === depotId)).toBe(true);
    const dist = await json(call("GET", "/v1/wh/loading?as_of=2025-10-13", undefined, await login("d01-pune")));
    expect(dist[0].trucks.every((t: { truck: { to_id: string } }) => t.truck.to_id === "D01-Pune")).toBe(true);
  });
});
