/**
 * Warehouse app routes (/v1/wh/*). Login, then every route is scoped to the user's node:
 * a depot user sees its two stores and the godowns of the distributors it serves, and changes only its own stock;
 * a distributor user sees and changes only its own godown; a planner sees and changes every node.
 * Demo users are derived from the network (one per depot and distributor, plus a planner) and share one demo PIN
 * (WH_DEMO_PIN, see docs/Warehouse-app.md). Counts and adjustments are kept per day and applied by the engine
 * before space is shown or a plan is made.
 */
import { randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type {
  AtRisk, DispatchResponse, LoginRequest, Message, Movement, MovementRequest, Scenario, Session, SpaceReport, WhOrder, WhRespondRequest,
  WhStock, WhStockRow, WhUser,
} from "@dia/types";
import type { Repo } from "./db/repo";
import type { EngineClient } from "./engine/client";
import { validate } from "./validation";

/** First day of the test window: the warehouse "today" until a plan has been made. */
const DEFAULT_DAY = "2025-09-29";
const DAY_MS = 86_400_000;

type Deps = { repo: Repo; engine: EngineClient; dispatch: (planId: string, depot?: string) => DispatchResponse; demoPin: string };

export function usersFor(sc: Scenario): WhUser[] {
  const users: WhUser[] = [{ user_id: "planner", name: "Supply planner", role: "planner", node_id: null }];
  for (const n of sc.nodes) {
    users.push({
      user_id: n.node_id.toLowerCase(), node_id: n.node_id,
      role: n.type === "depot" ? "depot" : "distributor", name: `${n.city} ${n.type === "depot" ? "depot" : "distributor"}`,
    });
  }
  return users;
}

export function warehouseRoutes(app: Hono, { repo, engine, dispatch, demoPin }: Deps): void {
  // Read on every request (no caching): the app follows whatever the planner sent last, scenario and day together.
  const scenario = async (): Promise<Scenario> => {
    const id = repo.latestPlanDay()?.scenario_id ?? [...(await engine.scenarios())].sort()[0];
    if (!id) throw new HTTPException(503, { message: "no scenario data: generate it first" });
    return engine.scenario(id);
  };
  const dayOf = (c: Context): string => c.req.query("as_of") ?? repo.latestPlanDay()?.as_of ?? DEFAULT_DAY;
  const userOf = (c: Context): WhUser => {
    const token = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const user = token ? repo.getSession(token) : null;
    if (!user) throw new HTTPException(401, { message: "log in first" });
    return user;
  };
  /** Nodes the user may see. A depot also sees the distributors it serves (their space is what it ships into). */
  const visible = (user: WhUser, sc: Scenario): Set<string> => {
    if (user.role === "planner") return new Set(sc.nodes.map((n) => n.node_id));
    if (user.role === "depot") return new Set([user.node_id!, ...sc.nodes.filter((n) => n.home_depot_id === user.node_id).map((n) => n.node_id)]);
    return new Set([user.node_id!]);
  };
  const canChange = (user: WhUser, nodeId: string) => user.role === "planner" || user.node_id === nodeId;

  app.get("/v1/wh/users", async (c) => c.json(usersFor(await scenario())));

  app.post("/v1/wh/login", async (c) => {
    const req = validate<LoginRequest>("LoginRequest", await c.req.json());
    const user = usersFor(await scenario()).find((u) => u.user_id === req.user_id.trim().toLowerCase());
    if (!user || req.pin !== demoPin) throw new HTTPException(401, { message: "unknown user or wrong PIN" });
    const session: Session = { token: randomBytes(24).toString("hex"), user };
    repo.createSession(session);
    return c.json(session);
  });

  app.get("/v1/wh/me", (c) => c.json(userOf(c)));

  app.get("/v1/wh/day", async (c) => {
    userOf(c);
    return c.json({ scenario_id: (await scenario()).scenario_id, as_of: dayOf(c) });
  });

  app.get("/v1/wh/space", async (c) => {
    const user = userOf(c);
    const sc = await scenario();
    const day = dayOf(c);
    const rep = await engine.space(sc.scenario_id, day, "imbalanced", repo.counts(sc.scenario_id, day));
    const see = visible(user, sc);
    const out: SpaceReport = { ...rep, depots: rep.depots.filter((n) => see.has(n.node_id)), distributors: rep.distributors.filter((n) => see.has(n.node_id)) };
    return c.json(out);
  });

  app.get("/v1/wh/stock", async (c) => {
    const user = userOf(c);
    const sc = await scenario();
    const day = dayOf(c);
    const nodeId = c.req.query("node_id") ?? user.node_id ?? sc.nodes.find((n) => n.type === "depot")!.node_id;
    if (!visible(user, sc).has(nodeId)) throw new HTTPException(403, { message: "not your warehouse" });
    const skus = new Map(sc.skus.map((s) => [s.sku_id, s]));
    const snap = await engine.snapshot(sc.scenario_id, day, "imbalanced");
    const counted = new Map(repo.counts(sc.scenario_id, day).filter((k) => k.node_id === nodeId).map((k) => [k.sku_id, k.cases]));
    const days = (d: string) => Math.round((Date.parse(d) - Date.parse(day)) / DAY_MS);
    const row = (skuId: string, lot: string | null, cases: number, expiry: string | null, state: WhStockRow["state"]): WhStockRow => {
      const s = skus.get(skuId)!;
      return { sku_id: skuId, sku_name: s.name, temp_class: s.temp_class, lot_id: lot, cases, m3: Math.round(cases * s.m3_per_case * 100) / 100,
        expiry, days_left: expiry ? days(expiry) : null, state };
    };
    const rows: WhStockRow[] = [
      ...snap.depot_lots.filter((l) => l.depot_id === nodeId && !counted.has(l.sku_id)).map((l) => row(l.sku_id, l.lot_id, l.qty_cases, l.expiry_date, "on_hand")),
      ...snap.dist_stock.filter((d) => d.dist_id === nodeId && !counted.has(d.sku_id)).map((d) => row(d.sku_id, d.lot_id ?? null, d.qty_cases, d.expiry_date, "on_hand")),
      ...snap.in_transit.filter((t) => t.to_id === nodeId).map((t) => row(t.sku_id, t.lot_id ?? null, t.qty_cases, t.expiry_date, "in_transit")),
      ...[...counted].map(([skuId, cases]) => row(skuId, null, cases, null, "counted")),
    ].filter((r) => r.cases > 0)
      .sort((a, b) => (a.days_left ?? 1e9) - (b.days_left ?? 1e9) || a.sku_name.localeCompare(b.sku_name));
    const out: WhStock = { node_id: nodeId, as_of: day, rows };
    return c.json(out);
  });

  app.get("/v1/wh/alerts", async (c) => {
    const user = userOf(c);
    const sc = await scenario();
    const see = visible(user, sc);
    const rows: AtRisk[] = await engine.atRisk(sc.scenario_id, dayOf(c), "imbalanced");
    return c.json(rows.filter((r) => see.has(r.dist_id)));
  });

  /** From the plans sent today. Depot: the trucks it loads, oldest stock first. Distributor: trucks coming to it. Planner: all. */
  app.get("/v1/wh/loading", async (c) => {
    const user = userOf(c);
    const sc = await scenario();
    const out: DispatchResponse[] = repo.sentPlansForDay(sc.scenario_id, dayOf(c)).map((p) => {
      if (user.role === "depot") return dispatch(p.plan_id, user.node_id!);
      const d = dispatch(p.plan_id);
      return user.role === "distributor" ? { ...d, trucks: d.trucks.filter((t) => t.truck.to_id === user.node_id) } : d;
    });
    return c.json(out);
  });

  app.post("/v1/wh/movements", async (c) => {
    const user = userOf(c);
    const req = validate<MovementRequest>("MovementRequest", await c.req.json());
    const sc = await scenario();
    const sku = sc.skus.find((s) => s.sku_id === req.sku_id);
    if (!sc.nodes.some((n) => n.node_id === req.node_id) || !sku) throw new HTTPException(422, { message: "unknown warehouse or product" });
    if (!canChange(user, req.node_id)) throw new HTTPException(403, { message: "you can only change your own stock" });
    if (req.kind !== "adjust" && req.cases < 0) throw new HTTPException(422, { message: "cases must be 0 or more" });
    const day = req.as_of ?? dayOf(c);
    if (req.kind === "count") repo.setCount(sc.scenario_id, day, req.node_id, req.sku_id, req.cases);
    if (req.kind === "adjust") {
      // Move the day's counted figure; with no count yet, start from what the system shows.
      const known = repo.counts(sc.scenario_id, day).find((k) => k.node_id === req.node_id && k.sku_id === req.sku_id)?.cases;
      let current = known;
      if (current === undefined) {
        const snap = await engine.snapshot(sc.scenario_id, day, "imbalanced");
        current = [...snap.depot_lots.filter((l) => l.depot_id === req.node_id), ...snap.dist_stock.filter((d) => d.dist_id === req.node_id)]
          .filter((x) => x.sku_id === req.sku_id).reduce((s, x) => s + x.qty_cases, 0);
      }
      repo.setCount(sc.scenario_id, day, req.node_id, req.sku_id, Math.max(current + req.cases, 0));
    }
    const m = repo.addMovement({ kind: req.kind, node_id: req.node_id, sku_id: req.sku_id, sku_name: sku.name, cases: req.cases,
      reason: req.reason ?? null, as_of: day, user_id: user.user_id, ts: new Date().toISOString() }, sc.scenario_id);
    return c.json(m satisfies Movement, 201);
  });

  app.get("/v1/wh/movements", async (c) => {
    const user = userOf(c);
    const sc = await scenario();
    return c.json(repo.listMovements(sc.scenario_id, dayOf(c), user.role === "planner" ? null : [...visible(user, sc)]));
  });

  /**
   * A distributor's orders in today's sent plans. The app answers them through the same response route as the
   * planner's Orders by city screen (same version checks and re-plan), with the distributor fixed to the user.
   */
  app.get("/v1/wh/orders", async (c) => {
    const user = userOf(c);
    const sc = await scenario();
    const dist = user.role === "distributor" ? user.node_id! : c.req.query("dist_id");
    if (!dist) throw new HTTPException(422, { message: "dist_id is required" });
    if (!visible(user, sc).has(dist)) throw new HTTPException(403, { message: "not your distributor" });
    const out: WhOrder[] = [];
    for (const p of repo.sentPlansForDay(sc.scenario_id, dayOf(c))) {
      const prop = repo.getProposals(p.plan_id).find((x) => x.dist_id === dist);
      if (!prop) continue;
      const r = await app.request(`/v1/plans/${encodeURIComponent(p.plan_id)}/inbox/${encodeURIComponent(dist)}`);
      if (!r.ok) continue;
      const msg = (await r.json()) as Message;
      const ids = new Set(msg.line_ids);
      out.push({
        plan_id: p.plan_id, version: p.version, temp_class: p.temp_class, dist_id: dist, proposal_version: prop.proposal_version,
        status: prop.status, replied: prop.responded_at != null, text: msg.text, lines: p.lines.filter((l) => ids.has(l.line_id)),
      });
    }
    return c.json(out);
  });

  app.post("/v1/wh/orders/respond", async (c) => {
    const user = userOf(c);
    if (user.role !== "distributor") throw new HTTPException(403, { message: "only a distributor answers its own order" });
    const req = validate<WhRespondRequest>("WhRespondRequest", await c.req.json());
    const r = await app.request(`/v1/plans/${encodeURIComponent(req.plan_id)}/responses`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ dist_id: user.node_id, proposal_version: req.proposal_version, actions: req.actions }),
    });
    return new Response(r.body, { status: r.status, headers: r.headers });
  });

  /** Read-only feed for the planner's web screen: what warehouse staff recorded on a day (no login, like the other planner routes). */
  app.get("/v1/scenarios/:id/movements", (c) => {
    const asOf = c.req.query("as_of");
    if (!asOf) throw new HTTPException(422, { message: "as_of is required" });
    return c.json(repo.listMovements(c.req.param("id"), asOf, null));
  });
}
