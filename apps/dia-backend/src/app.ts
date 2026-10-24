/**
 * Public /v1 API (owner: M2). Joins the engine (via EngineClient) and app state (via Repo).
 * Semantics: docs/Architecture.md "API". Request bodies are validated against the shared JSON Schema.
 */
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type {
  DispatchResponse, DispatchTruck, ExperimentAccepted, ExperimentRequest, ForecastRequest, ForecastResponse, LineDiff,
  Message, OpeningState, Plan, PlanRequest, Proposal, ProposalStatus, PublishRequest, PublishResponse,
  ResponseRequest, ResponseResult, Scenario,
} from "@dia/types";
import type { Repo } from "./db/repo";
import { EngineError, type EngineClient } from "./engine/client";
import { analyse } from "./ai/analyse";
import { lineFacts, planFacts, resultsFacts } from "./ai/facts";
import { llmFromEnv, statusOf } from "./ai";
import type { LlmClient } from "./ai/vertex";
import { DOCS_HTML, openapiDocument } from "./openapi";
import { validate } from "./validation";

/** llm: undefined reads the environment; null forces the rules-only path (tests). */
export type Deps = { repo: Repo; engine: EngineClient; llm?: LlmClient | null };

const now = () => new Date().toISOString();
const newPlanId = () => `PL-${crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`;

/** Serialises work per key (one distributor response at a time per plan, PRD 6.7). */
function keyedMutex() {
  const tails = new Map<string, Promise<unknown>>();
  return async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = tails.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    tails.set(key, run.catch(() => undefined));
    return run;
  };
}

export function diffPlans(oldPlan: Plan, newPlan: Plan): LineDiff[] {
  const totals = (p: Plan) => {
    const acc = new Map<string, { lineId: string; dist: string; cases: number }>();
    for (const l of p.lines) {
      const key = `${l.to_id}|${l.sku_id}|${l.lot_id}`;
      const cur = acc.get(key);
      acc.set(key, { lineId: l.line_id, dist: l.to_id, cases: (cur?.cases ?? 0) + l.cases });
    }
    return acc;
  };
  const a = totals(oldPlan);
  const b = totals(newPlan);
  const out: LineDiff[] = [];
  for (const key of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const o = a.get(key)?.cases ?? 0;
    const n = b.get(key)?.cases ?? 0;
    if (o !== n) out.push({ line_id: (b.get(key) ?? a.get(key))!.lineId, dist_id: (b.get(key) ?? a.get(key))!.dist, old_cases: o, new_cases: n });
  }
  return out;
}

function message(plan: Plan, dist: string, pv: number, scenario: Scenario, credit: number): Message {
  const price = new Map(scenario.skus.map((s) => [s.sku_id, s.price_inr]));
  const lines = plan.lines.filter((l) => l.to_id === dist);
  const total = lines.reduce((s, l) => s + l.cases * (price.get(l.sku_id) ?? 0), 0);
  const fmt = (n: number) => Math.round(n).toLocaleString("en-IN");
  return {
    dist_id: dist, proposal_version: pv, line_ids: lines.map((l) => l.line_id), total_value_inr: total,
    credit_available_inr: credit,
    text: `Vitaran proposal v${pv} for ${dist}: ${lines.length} lines, Rs ${fmt(total)} against Rs ${fmt(credit)} credit available.`,
  };
}

export function createApp({ repo, engine, llm: llmDep }: Deps): Hono {
  const app = new Hono();
  const fromEnv = llmDep === undefined ? llmFromEnv() : null;
  const llm: LlmClient | null = llmDep === undefined ? fromEnv!.llm : llmDep;
  const withPlanLock = keyedMutex();

  app.onError((err, c) => {
    if (err instanceof EngineError) {
      const status = err.status === 422 ? 500 : err.status;   // engine 422 = validator violations = server-side bug
      return c.json({ detail: err.message, engine: err.body }, status as 404);
    }
    if (err instanceof HTTPException) return c.json({ detail: err.message }, err.status);
    console.error(err);
    return c.json({ detail: String(err) }, 500);
  });

  const planOr404 = (id: string, version?: number): Plan => {
    const p = repo.loadPlan(id, version);
    if (!p) throw new HTTPException(404, { message: `plan ${id} v${version ?? "latest"} not found` });
    return p;
  };
  const openingState = (q: string | undefined): OpeningState => (q === "neutral" ? "neutral" : "imbalanced");

  // ------------------------------------------------------------------ meta
  app.get("/v1/health", async (c) => {
    let engineStatus = "down";
    try { engineStatus = (await engine.health()).status; } catch { /* engine not reachable */ }
    return c.json({ status: "ok", engine_mode: engine.mode, engine: engineStatus, fake_backend: engine.mode === "fake" });
  });
  app.get("/v1/scenarios", async (c) => c.json(await engine.scenarios()));
  app.get("/v1/scenarios/:id", async (c) => c.json(await engine.scenario(c.req.param("id"))));
  app.get("/v1/assumptions", async (c) => c.json(await engine.assumptions()));
  app.get("/openapi.json", (c) => c.json(openapiDocument()));
  app.get("/docs", (c) => c.html(DOCS_HTML));

  // ------------------------------------------------------------------ J1 planning
  app.get("/v1/scenarios/:id/snapshot", async (c) => {
    const asOf = c.req.query("as_of");
    if (!asOf) throw new HTTPException(422, { message: "as_of is required" });
    return c.json(await engine.snapshot(c.req.param("id"), asOf, openingState(c.req.query("opening_state"))));
  });

  app.post("/v1/forecasts", async (c) => {
    const req = validate<ForecastRequest>("ForecastRequest", await c.req.json());
    const bundle = await engine.forecast({ scenario_id: req.scenario_id, as_of: req.as_of, horizon_days: (req.horizon_weeks ?? 4) * 7 });
    const res: ForecastResponse = { rows: bundle.weekly ?? [], metrics: await engine.backtest(req.scenario_id) };
    return c.json(res);
  });

  app.post("/v1/plans", async (c) => {
    const req = validate<PlanRequest>("PlanRequest", await c.req.json());
    let planId = newPlanId();
    let version = 1;
    if (req.base_plan_id) {
      const base = planOr404(req.base_plan_id);
      planId = base.plan_id;
      version = base.version + 1;
    }
    const plan = await engine.plan({
      scenario_id: req.scenario_id, as_of: req.as_of, temp_class: req.temp_class,
      opening_state: openingState(c.req.query("opening_state")), settings: { weights: req.weights },
      locks: req.locks ?? [], plan_id: planId, version,
    });
    repo.tx(() => {
      repo.savePlan(plan);
      if (req.base_plan_id) repo.logEvent({ plan_id: planId, plan_version: version, dist_id: null, actor: "planner", action: "replan", ts: now() });
    });
    return c.json(plan);
  });

  app.get("/v1/plans/:id", (c) => {
    const v = c.req.query("version");
    return c.json(planOr404(c.req.param("id"), v ? Number(v) : undefined));
  });

  app.post("/v1/plans/:id/publish", async (c) => {
    const planId = c.req.param("id");
    const req = validate<PublishRequest>("PublishRequest", await c.req.json());
    const plan = planOr404(planId, req.version);
    const [scenario, snap] = await Promise.all([engine.scenario(plan.scenario_id), engine.snapshot(plan.scenario_id, plan.as_of, "imbalanced")]);
    const messages: Message[] = [];
    repo.tx(() => {
      plan.status = "PROPOSED";
      repo.savePlan(plan);
      const previous = new Map(repo.getProposals(planId).map((p) => [p.dist_id, p]));
      for (const dist of [...new Set(plan.lines.map((l) => l.to_id))].sort()) {
        const pv = (previous.get(dist)?.proposal_version ?? 0) + 1;
        repo.upsertProposal({ plan_id: planId, dist_id: dist, proposal_version: pv, status: "PROPOSED", sent_at: now(), responded_at: null });
        messages.push(message(plan, dist, pv, scenario, snap.credit_available_inr[dist] ?? 0));
      }
      repo.logEvent({ plan_id: planId, plan_version: plan.version, dist_id: null, actor: "planner", action: "publish", ts: now() });
    });
    const res: PublishResponse = { plan_id: planId, version: plan.version, messages };
    return c.json(res);
  });

  // ------------------------------------------------------------------ J2 distributor loop
  app.get("/v1/plans/:id/proposals", (c) => c.json(repo.getProposals(c.req.param("id"))));

  app.get("/v1/plans/:id/inbox/:dist", async (c) => {
    const plan = planOr404(c.req.param("id"));
    const dist = c.req.param("dist");
    const prop = repo.getProposals(plan.plan_id).find((p) => p.dist_id === dist);
    if (!prop) throw new HTTPException(404, { message: `no proposal for ${dist}; publish the plan first` });
    const [scenario, snap] = await Promise.all([engine.scenario(plan.scenario_id), engine.snapshot(plan.scenario_id, plan.as_of, "imbalanced")]);
    return c.json(message(plan, dist, prop.proposal_version, scenario, snap.credit_available_inr[dist] ?? 0));
  });

  app.post("/v1/plans/:id/responses", async (c) => {
    const planId = c.req.param("id");
    const req = validate<ResponseRequest>("ResponseRequest", await c.req.json());
    const result = await withPlanLock(planId, async () => {
      const plan = planOr404(planId);
      const props = repo.getProposals(planId);
      const mine = props.find((p) => p.dist_id === req.dist_id);
      if (!mine) throw new HTTPException(404, { message: `no proposal for ${req.dist_id}` });
      if (mine.proposal_version !== req.proposal_version) {
        throw new HTTPException(409, { message: `stale proposal version ${req.proposal_version}; current is ${mine.proposal_version}` });
      }
      const own = new Map(plan.lines.filter((l) => l.to_id === req.dist_id).map((l) => [l.line_id, l]));
      for (const a of req.actions) {
        const line = own.get(a.line_id);
        if (!line) throw new HTTPException(422, { message: `line ${a.line_id} is not in ${req.dist_id}'s current proposal` });
        if (a.action === "trim" && (a.qty == null || a.qty < 0 || a.qty > line.cases)) {
          throw new HTTPException(422, { message: `trim qty for ${a.line_id} must be between 0 and ${line.cases}` });
        }
      }

      const next = await engine.resolve({ plan, proposals: props, response: req, opening_state: "imbalanced" });
      next.status = "PROPOSED";
      const diff = diffPlans(plan, next);
      const grown = [...new Set(diff.filter((d) => d.new_cases > d.old_cases && d.dist_id !== req.dist_id).map((d) => d.dist_id))].sort();
      const kinds = new Set(req.actions.map((a) => a.action));
      const status: ProposalStatus = kinds.size === 1 && kinds.has("reject") ? "REJECTED" : kinds.has("trim") ? "TRIMMED" : "ACCEPTED";
      const delta = (next.expected_kpis?.total_inr ?? 0) - (plan.expected_kpis?.total_inr ?? 0);
      const ts = now();
      repo.tx(() => {
        repo.savePlan(next);
        repo.upsertProposal({ ...mine, status, responded_at: ts });
        for (const p of props) if (grown.includes(p.dist_id)) repo.upsertProposal({ ...p, proposal_version: p.proposal_version + 1 });
        for (const a of req.actions) {
          const oldQty = own.get(a.line_id)!.cases;
          const newQty = a.action === "accept" ? oldQty : a.action === "trim" ? a.qty! : 0;
          repo.logEvent({ plan_id: planId, plan_version: next.version, dist_id: req.dist_id, actor: req.dist_id, action: a.action,
            line_id: a.line_id, old_qty: oldQty, new_qty: newQty, delta_cost_inr: a.action === "accept" ? 0 : delta, ts });
        }
        for (const d of diff) if (grown.includes(d.dist_id)) {
          repo.logEvent({ plan_id: planId, plan_version: next.version, dist_id: d.dist_id, actor: "engine", action: "grow",
            line_id: d.line_id, old_qty: d.old_cases, new_qty: d.new_cases, delta_cost_inr: 0, ts });
        }
      });
      const res: ResponseResult = { plan_version: next.version, proposal_version: req.proposal_version, grown_proposals: grown, line_diff: diff, delta_cost_inr: delta };
      return res;
    });
    return c.json(result);
  });

  app.get("/v1/plans/:id/events", (c) => c.json(repo.listEvents(c.req.param("id"))));

  // ------------------------------------------------------------------ J3 dispatch
  const dispatch = (planId: string, depot?: string, version?: number): DispatchResponse => {
    const plan = planOr404(planId, version);
    const byId = new Map(plan.lines.map((l) => [l.line_id, l]));
    const trucks: DispatchTruck[] = [];
    for (const t of plan.trucks) {
      if (depot && t.from_id !== depot) continue;
      const lines = t.line_ids.map((i) => byId.get(i)!).filter((l) => l && l.status !== "REJECTED" && l.cases > 0)
        .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.lot_id.localeCompare(b.lot_id));   // FEFO pick order
      if (lines.length) trucks.push({ truck: t, lines });
    }
    return { plan_id: planId, version: plan.version, depot_id: depot ?? null, trucks };
  };

  app.get("/v1/plans/:id/dispatch", (c) => {
    const v = c.req.query("version");
    return c.json(dispatch(c.req.param("id"), c.req.query("depot"), v ? Number(v) : undefined));
  });

  app.get("/v1/plans/:id/dispatch.csv", (c) => {
    const v = c.req.query("version");
    const d = dispatch(c.req.param("id"), c.req.query("depot"), v ? Number(v) : undefined);
    const rows = [["truck_id", "mode", "truck_class", "from_id", "to_id", "ship_date", "kg_pct", "m3_pct", "line_id", "sku_id", "sku_name", "lot_id", "expiry", "cases"]];
    for (const { truck: t, lines } of d.trucks) {
      for (const l of lines) {
        rows.push([t.truck_id, t.mode, t.truck_class ?? "", t.from_id, t.to_id, t.ship_date, t.kg_pct.toFixed(1), t.m3_pct.toFixed(1),
          l.line_id, l.sku_id, l.sku_name, l.lot_id, l.expiry, String(l.cases)]);
      }
    }
    const csv = rows.map((r) => r.map((v) => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)).join(",")).join("\r\n");
    return new Response(`﻿${csv}\r\n`, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="dispatch_${d.plan_id}.csv"` },
    });
  });

  // ------------------------------------------------------------------ J4 evaluation
  app.post("/v1/experiments", async (c) => {
    const req = validate<ExperimentRequest>("ExperimentRequest", await c.req.json().catch(() => ({})));
    const hash = createHash("sha256").update(JSON.stringify(await engine.assumptions()) + JSON.stringify(req)).digest("hex").slice(0, 12);
    const [id, cached] = repo.createExperiment(hash);
    if (!cached) {
      repo.updateExperiment(id, "running", 0);
      const job = engine.runExperiment(id, req, (pct) => repo.updateExperiment(id, "running", pct))
        .then((o) => (o.status === "done" ? repo.updateExperiment(id, "done", 100) : repo.updateExperiment(id, "failed", 0, o.error)))
        .catch((e) => repo.updateExperiment(id, "failed", 0, String(e)));
      if (engine.mode === "fake") await job;   // instant in fake mode; real jobs run in the background
    }
    const res: ExperimentAccepted = { experiment_id: id, cached };
    return c.json(res, 202);
  });

  app.get("/v1/experiments/:id", (c) => {
    const info = repo.getExperiment(c.req.param("id"));
    if (!info) throw new HTTPException(404, { message: "experiment not found" });
    return c.json(info);
  });

  app.get("/v1/experiments/:id/results", async (c) => {
    const info = repo.getExperiment(c.req.param("id"));
    if (!info || info.status !== "done") throw new HTTPException(404, { message: "results not ready" });
    const res = await engine.experimentResults(info.experiment_id);
    if (!res) throw new HTTPException(404, { message: "results file missing" });
    return c.json(res);
  });

  // ------------------------------------------------------------------ analysis on demand (FR-25)
  app.get("/v1/ai/status", (c) => c.json(statusOf(llm, fromEnv?.status.reason ?? "no model configured")));

  app.post("/v1/ai/analyse", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { kind?: string; plan_id?: string; version?: number; line_id?: string; experiment_id?: string; opening_state?: string; question?: string };
    const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) || undefined : undefined;
    let facts;
    if (body.kind === "plan" || body.kind === "line") {
      if (!body.plan_id) throw new HTTPException(422, { message: "plan_id is required" });
      const plan = planOr404(body.plan_id, body.version);
      const scenario = await engine.scenario(plan.scenario_id).catch(() => null);
      facts = body.kind === "plan" ? planFacts(plan, scenario) : lineFacts(plan, body.line_id ?? "", scenario);
      if (!facts) throw new HTTPException(404, { message: `line ${body.line_id} not found` });
    } else if (body.kind === "results") {
      if (!body.experiment_id) throw new HTTPException(422, { message: "experiment_id is required" });
      const info = repo.getExperiment(body.experiment_id);
      if (!info || info.status !== "done") throw new HTTPException(404, { message: "results not ready" });
      const res = await engine.experimentResults(info.experiment_id);
      if (!res) throw new HTTPException(404, { message: "results file missing" });
      facts = resultsFacts(res, openingState(body.opening_state));
    } else {
      throw new HTTPException(422, { message: "kind must be plan, line or results" });
    }
    return c.json(await analyse(llm, facts, question));
  });

  return app;
}
