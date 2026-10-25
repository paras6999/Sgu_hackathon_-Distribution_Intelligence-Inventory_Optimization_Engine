/**
 * Public /v1 API (owner: M2). Joins the engine (via EngineClient) and app state (via Repo).
 * Semantics: docs/Architecture.md "API". Request bodies are validated against the shared JSON Schema.
 */
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type {
  AssistantContext, AssistantRequest, AssistantResponse, AssistantStep, DispatchResponse, DispatchTruck, ExperimentAccepted, ExperimentRequest,
  ForecastRequest, ForecastResponse, LineDiff, Message, OpeningState, OrderSummary, OrdersView, Plan, PlanRequest, Proposal,
  ProposalStatus, PublishRequest, PublishResponse, ResponseRequest, ResponseResult, Scenario, UiAction,
} from "@dia/types";
import type { Repo } from "./db/repo";
import { parseIntent, type DistRef, type Intent, type Page, type Tool } from "./assistant/intent";
import { routeWithModel } from "./assistant/model";
import { describeView, matchNavigate, matchView, PAGE_LABEL, type ViewRefs } from "./assistant/viewTools";
import { EngineError, type EngineClient } from "./engine/client";
import { analyse, type Analysis } from "./ai/analyse";
import { demandFacts, lineFacts, planFacts, resultsFacts } from "./ai/facts";
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

const inr = (n: number) => Math.round(n).toLocaleString("en-IN");
const lakh = (v: number) => (v / 100000).toFixed(2);
const crore = (v: number) => (v / 10000000).toFixed(2);
/** Share of credit used, in percent with one decimal. Zero when there is no credit. */
const creditUsedPct = (value: number, credit: number) => (credit > 0 ? Math.round((value / credit) * 1000) / 10 : 0);
/** Keeps assistant replies under the 400-character limit. */
const clip = (s: string, max = 390) => (s.length > max ? `${s.slice(0, max - 3)}...` : s);
const serve = (v: number | undefined) => (v === undefined ? "cost not reported" : `cost to serve Rs ${lakh(v)} lakh`);
/** Plan request that keeps the scenario, date, temperature class and weights of an existing plan. */
const planRequestFor = (plan: Plan, extra: Partial<PlanRequest> = {}): PlanRequest => ({
  scenario_id: plan.scenario_id, as_of: plan.as_of, temp_class: plan.temp_class,
  ...(plan.settings?.weights ? { weights: plan.settings.weights } : {}), ...extra,
});
type ToolOutcome = {
  status: AssistantResponse["status"]; reply: string; steps: AssistantStep[];
  plan_version?: number; plan_status?: string; pending_action?: string;
  ui_action?: UiAction | null; source?: "rules" | "ai";
};

const HELP_REPLY = "I can check order status, explain an order, check credit, check stock at risk, run a what-if (diesel, a depot offline, or demand), approve and send, or replan.";
/** Tools that need an open plan. Without one they answer "Open Planning first." */
const PLAN_TOOLS: ReadonlySet<Tool> = new Set<Tool>(["explain_order", "orders_status", "credit_report", "publish_plan", "replan", "whatif"]);
/** Tools the page applies or that analyse a page. They are answered by runView. */
const VIEW_TOOLS: ReadonlySet<Tool> = new Set<Tool>(["navigate", "set_view", "select_lane", "explain_results", "explain_demand"]);
/** Analysis text for the sidebar. A note about the model or rules path goes after it. */
const analysisReply = (a: Analysis): string => (a.note ? `${a.text}\n\n${a.note}` : a.text);

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

  /** One row per distributor proposal, with totals. Value and credit come from the same calculation as the inbox. */
  const buildOrders = async (plan: Plan): Promise<OrdersView> => {
    const [scenario, snap] = await Promise.all([engine.scenario(plan.scenario_id), engine.snapshot(plan.scenario_id, plan.as_of, "imbalanced")]);
    const draftVersion = repo.firstVersion(plan.plan_id) ?? plan.version;
    const draft = repo.loadPlan(plan.plan_id, draftVersion) ?? plan;
    const casesOf = (p: Plan, dist: string) => p.lines.filter((l) => l.to_id === dist).reduce((s, l) => s + l.cases, 0);
    // A draft has no proposals yet: show its orders from the plan lines, marked not sent (version 0).
    const sent = repo.getProposals(plan.plan_id);
    const sources = sent.length > 0
      ? sent.map((p) => ({ dist_id: p.dist_id, status: p.status, proposal_version: p.proposal_version }))
      : [...new Set(plan.lines.map((l) => l.to_id))].map((dist) => ({ dist_id: dist, status: "PROPOSED" as const, proposal_version: 0 }));
    const orders: OrderSummary[] = sources.map((prop) => {
      const credit = snap.credit_available_inr[prop.dist_id] ?? 0;
      const value = message(plan, prop.dist_id, prop.proposal_version, scenario, credit).total_value_inr;
      const cases = casesOf(plan, prop.dist_id);
      return {
        dist_id: prop.dist_id,
        dist_city: scenario.nodes.find((n) => n.node_id === prop.dist_id)?.city ?? prop.dist_id,
        status: prop.status,
        proposal_version: prop.proposal_version,
        lines: plan.lines.filter((l) => l.to_id === prop.dist_id).length,
        cases,
        value_inr: value,
        credit_available_inr: credit,
        credit_used_pct: creditUsedPct(value, credit),
        cases_since_draft: cases - casesOf(draft, prop.dist_id),
        replied: prop.status !== "PROPOSED",
      };
    }).sort((a, b) => b.value_inr - a.value_inr);
    const sum = (f: (o: OrderSummary) => number) => orders.reduce((s, o) => s + f(o), 0);
    const value = sum((o) => o.value_inr);
    const credit = sum((o) => o.credit_available_inr);
    return {
      plan_id: plan.plan_id, version: plan.version, draft_version: draftVersion, plan_status: plan.status ?? "DRAFT", orders,
      totals: {
        orders: orders.length, replied: orders.filter((o) => o.replied).length, lines: sum((o) => o.lines),
        cases: sum((o) => o.cases), value_inr: value, credit_available_inr: credit, credit_used_pct: creditUsedPct(value, credit),
        draft_lines: draft.lines.length, draft_cases: draft.lines.reduce((s, l) => s + l.cases, 0),
      },
    };
  };

  /** Generates a plan (new plan id, or the next version when base_plan_id is set) and saves it. */
  const createPlan = async (req: PlanRequest, opening: OpeningState): Promise<Plan> => {
    let planId = newPlanId();
    let version = 1;
    if (req.base_plan_id) {
      const base = planOr404(req.base_plan_id);
      planId = base.plan_id;
      version = base.version + 1;
    }
    const plan = await engine.plan({
      scenario_id: req.scenario_id, as_of: req.as_of, temp_class: req.temp_class,
      opening_state: opening, settings: { weights: req.weights },
      locks: req.locks ?? [], what_if: req.what_if ?? null, plan_id: planId, version,
    });
    repo.tx(() => {
      repo.savePlan(plan);
      if (req.base_plan_id) repo.logEvent({ plan_id: planId, plan_version: version, dist_id: null, actor: "planner", action: "replan", ts: now() });
    });
    return plan;
  };

  /** Marks the plan version PROPOSED and creates or bumps one proposal per distributor (PRD FR-08). */
  const publishPlan = async (planId: string, version?: number): Promise<PublishResponse> => {
    const plan = planOr404(planId, version);
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
    return { plan_id: planId, version: plan.version, messages };
  };

  /**
   * Runs one assistant tool on the current plan. Consequential tools (publish, replan) return needs_confirmation
   * without acting when askFirst is set.
   */
  const runTool = async (intent: Intent, plan: Plan | null, dists: DistRef[], askFirst: boolean, page: Page, context: AssistantContext): Promise<ToolOutcome> => {
    if (intent.tool === "check_at_risk") {
      // On the stock page the date the planner picked wins; otherwise the plan's date. No plan: the first scenario.
      const asOf = page === "stock" && context.as_of ? context.as_of : plan?.as_of ?? context.as_of;
      const scenarioId = plan?.scenario_id ?? (await engine.scenarios())[0];
      if (!asOf || !scenarioId) return { status: "answered", reply: "Open Planning first.", steps: [] };
      const rows = await engine.atRisk(scenarioId, asOf, "imbalanced");
      const top = rows.slice(0, 2).map((r) => `${r.dist_city} ${r.sku_name}: ${inr(r.expected_expired_cases)} cases, ships within days`);
      const reply = rows.length === 0
        ? `No lots are expected to expire before they sell as of ${asOf}.`
        : `${rows.length} lots at risk of expiry. ${top.join("; ")}.`;
      return {
        status: "answered", reply,
        steps: [{ tool: "check_at_risk", status: "done", summary: `${rows.length} lots at risk`, plan_id: plan?.plan_id ?? null, plan_version: plan?.version ?? null }],
      };
    }
    if (!plan) return PLAN_TOOLS.has(intent.tool) ? { status: "answered", reply: "Open Planning first.", steps: [] } : { status: "answered", reply: HELP_REPLY, steps: [] };
    return runPlanTool(intent, plan, dists, askFirst);
  };

  const runPlanTool = async (intent: Intent, plan: Plan, dists: DistRef[], askFirst: boolean): Promise<ToolOutcome> => {
    const step = (tool: string, status: AssistantStep["status"], summary: string, at = { plan_id: plan.plan_id, plan_version: plan.version }): AssistantStep =>
      ({ tool, status, summary, plan_id: at.plan_id, plan_version: at.plan_version });
    const sellers = new Set(plan.lines.map((l) => l.to_id)).size;
    switch (intent.tool) {
      case "orders_status": {
        const t = (await buildOrders(plan)).totals;
        const reply = t.orders === 0
          ? "No orders yet. Approve and send the plan to create them."
          : `${t.orders} orders, ${t.replied} replied, ${inr(t.lines)} lines, ${inr(t.cases)} cases, Rs ${crore(t.value_inr)} crore.`;
        return { status: "answered", reply, steps: [step("orders_status", "done", "Read order totals")] };
      }
      case "explain_order": {
        const id = intent.dist_id ?? "";
        const o = (await buildOrders(plan)).orders.find((x) => x.dist_id === id);
        if (!o) {
          const city = dists.find((d) => d.dist_id === id)?.city ?? id;
          return {
            status: "answered", reply: `${city} has no order in this plan yet. Approve and send the plan to create one.`,
            steps: [step("explain_order", "done", `No order for ${city}`)],
          };
        }
        const since = Math.round(o.cases_since_draft);
        const change = since > 0 ? `up ${inr(since)} cases from the draft` : since < 0 ? `down ${inr(-since)} cases from the draft` : "no change from the draft";
        const reply = `${o.dist_city}: ${o.lines} lines, ${inr(o.cases)} cases, Rs ${lakh(o.value_inr)} lakh of Rs ${lakh(o.credit_available_inr)} lakh credit (${o.credit_used_pct}% used), ${change}.`;
        return { status: "answered", reply, steps: [step("explain_order", "done", `Read ${o.dist_city} order`)] };
      }
      case "credit_report": {
        const full = (await buildOrders(plan)).orders.filter((o) => o.credit_used_pct >= 99.5);
        const reply = full.length === 0
          ? "No distributor is at 99.5% or more of its credit."
          : `${full.length} ${full.length === 1 ? "distributor" : "distributors"} at 99.5% or more of credit: ${full.map((o) => o.dist_city).join(", ")}.`;
        return { status: "answered", reply, steps: [step("credit_report", "done", `${full.length} at 99.5% or more`)] };
      }
      case "whatif": {
        const change = intent.what_if ?? {};
        if (Object.keys(change).length === 0) {
          return { status: "answered", reply: "Name a change to test: diesel price, a depot going offline, or demand up or down in a region.", steps: [] };
        }
        const next = await createPlan(validate<PlanRequest>("PlanRequest", planRequestFor(plan, { what_if: change })), "imbalanced");
        const cases = (p: Plan) => p.lines.reduce((s, l) => s + l.cases, 0);
        const before = plan.expected_kpis?.total_inr;
        const after = next.expected_kpis?.total_inr;
        const pct = before && after !== undefined ? Math.round(((after - before) / before) * 1000) / 10 : undefined;
        const reply = `Current plan: ${inr(cases(plan))} cases, ${serve(before)}. What-if plan: ${inr(cases(next))} cases, ${serve(after)}${pct === undefined ? "" : ` (${pct > 0 ? "+" : ""}${pct}% cost)`}.`;
        return {
          status: "completed", reply,
          steps: [step("whatif", "done", `Ran what-if plan ${next.plan_id}`, { plan_id: next.plan_id, plan_version: next.version })],
        };
      }
      case "publish_plan": {
        if (plan.status === "PROPOSED") {
          return { status: "completed", reply: "This plan was already sent to distributors.", steps: [step("publish_plan", "skipped", "Already sent")] };
        }
        if (askFirst) {
          return { status: "needs_confirmation", reply: `Ready to approve and send ${sellers} orders. Confirm to continue.`, steps: [], pending_action: "publish_plan" };
        }
        const res = await publishPlan(plan.plan_id, plan.version);
        const sent = res.messages.length;
        return {
          status: "completed", reply: `Sent ${sent} orders to distributors.`, steps: [step("publish_plan", "done", `Sent ${sent} orders`)],
          plan_status: planOr404(plan.plan_id, res.version).status ?? "PROPOSED",
        };
      }
      case "replan": {
        if (askFirst) {
          return { status: "needs_confirmation", reply: `Ready to create version ${plan.version + 1} of this plan. Confirm to continue.`, steps: [], pending_action: "replan" };
        }
        const next = await createPlan(validate<PlanRequest>("PlanRequest", planRequestFor(plan, { base_plan_id: plan.plan_id })), "imbalanced");
        return {
          status: "completed", reply: `Created version ${next.version} of this plan. Review it, then approve and send.`,
          steps: [step("replan", "done", `Created version ${next.version}`, { plan_id: plan.plan_id, plan_version: next.version })],
          plan_version: next.version, plan_status: next.status ?? "DRAFT",
        };
      }
      default:
        return { status: "answered", steps: [], reply: HELP_REPLY };
    }
  };

  /** Page tools: navigation, filters, lane selection and page analysis. Null when the tool does not apply on this page. */
  const runView = async (intent: Intent, page: Page, context: AssistantContext, message: string, refs: ViewRefs, plan: Plan | null): Promise<ToolOutcome | null> => {
    const answer = (tool: string, reply: string, extra: Partial<ToolOutcome> = {}): ToolOutcome => ({
      status: "answered", reply, steps: [{ tool, status: "done", summary: reply, plan_id: plan?.plan_id ?? null, plan_version: plan?.version ?? null }],
      ...extra,
    });
    const cityOf = (id: string) => refs.places.find((p) => p.node_id === id)?.city ?? id;
    const view = intent.view ?? {};
    switch (intent.tool) {
      case "navigate": {
        const target = intent.page;
        if (!target) return null;
        if (target === page) return answer("navigate", `You are already on ${PAGE_LABEL[page]}.`);
        return answer("navigate", `Opening ${PAGE_LABEL[target]}.`, { ui_action: { type: "navigate", page: target } });
      }
      case "set_view": {
        if (page === "planning" || Object.keys(view).length === 0) return null;
        return answer("set_view", `Showing ${describeView(view, refs).join(", ")}.`, { ui_action: { type: "set_filters", ...view } });
      }
      case "select_lane": {
        if (page !== "map" || Object.keys(view).length === 0) return null;
        const from = view.lane_from ? cityOf(view.lane_from) : null;
        const to = view.lane_to ? cityOf(view.lane_to) : null;
        const reply = from && to ? `Showing lanes from ${from} to ${to}.` : from ? `Showing lanes from ${from}.` : `Showing lanes to ${to}.`;
        return answer("select_lane", reply, { ui_action: { type: "select_lane", ...view } });
      }
      case "explain_results": {
        if (page !== "results" && page !== "frontier") return null;
        const info = context.experiment_id ? repo.getExperiment(context.experiment_id) : null;
        const res = info?.status === "done" ? await engine.experimentResults(info.experiment_id) : null;
        if (!res) return answer("explain_results", "The results are not ready yet.");
        const a = await analyse(llm, resultsFacts(res, openingState(context.opening_state)), message);
        return answer("explain_results", analysisReply(a), { source: a.source });
      }
      case "explain_demand": {
        if (page !== "demand") return null;
        const scenarioId = plan?.scenario_id ?? (await engine.scenarios())[0];
        if (!scenarioId) return answer("explain_demand", "No scenario is loaded yet.");
        const [bt, fx] = await Promise.all([engine.backtest(scenarioId), engine.effects(scenarioId)]);
        const a = await analyse(llm, demandFacts(bt, fx), message);
        return answer("explain_demand", analysisReply(a), { source: a.source });
      }
      default:
        return null;
    }
  };

  // ------------------------------------------------------------------ meta
  app.get("/v1/health", async (c) => {
    let engineStatus = "down";
    try { engineStatus = (await engine.health()).status; } catch { /* engine not reachable */ }
    return c.json({ status: "ok", engine_mode: engine.mode, engine: engineStatus, fake_backend: engine.mode === "fake" });
  });
  app.get("/v1/scenarios", async (c) => c.json(await engine.scenarios()));
  app.get("/v1/scenarios/:id", async (c) => c.json(await engine.scenario(c.req.param("id"))));
  app.get("/v1/scenarios/:id/history", async (c) => c.json(await engine.history(c.req.param("id"), c.req.query("dist_id") || undefined, c.req.query("sku_id") || undefined)));
  app.get("/v1/scenarios/:id/effects", async (c) => c.json(await engine.effects(c.req.param("id"))));
  app.get("/v1/scenarios/:id/backtest", async (c) => c.json(await engine.backtest(c.req.param("id"))));
  app.get("/v1/assumptions", async (c) => c.json(await engine.assumptions()));
  app.get("/openapi.json", (c) => c.json(openapiDocument()));
  app.get("/docs", (c) => c.html(DOCS_HTML));

  // ------------------------------------------------------------------ J1 planning
  app.get("/v1/scenarios/:id/snapshot", async (c) => {
    const asOf = c.req.query("as_of");
    if (!asOf) throw new HTTPException(422, { message: "as_of is required" });
    return c.json(await engine.snapshot(c.req.param("id"), asOf, openingState(c.req.query("opening_state"))));
  });

  app.get("/v1/scenarios/:id/at-risk", async (c) => {
    const asOf = c.req.query("as_of");
    if (!asOf) throw new HTTPException(422, { message: "as_of is required" });
    return c.json(await engine.atRisk(c.req.param("id"), asOf, openingState(c.req.query("opening_state"))));
  });

  app.post("/v1/forecasts", async (c) => {
    const req = validate<ForecastRequest>("ForecastRequest", await c.req.json());
    const bundle = await engine.forecast({ scenario_id: req.scenario_id, as_of: req.as_of, horizon_days: (req.horizon_weeks ?? 4) * 7 });
    const res: ForecastResponse = { rows: bundle.weekly ?? [], metrics: await engine.backtest(req.scenario_id) };
    return c.json(res);
  });

  app.post("/v1/plans", async (c) => {
    const req = validate<PlanRequest>("PlanRequest", await c.req.json());
    return c.json(await createPlan(req, openingState(c.req.query("opening_state"))));
  });

  app.get("/v1/plans/:id", (c) => {
    const v = c.req.query("version");
    return c.json(planOr404(c.req.param("id"), v ? Number(v) : undefined));
  });

  app.get("/v1/plans/:id/orders", async (c) => {
    const v = c.req.query("version");
    return c.json(await buildOrders(planOr404(c.req.param("id"), v ? Number(v) : undefined)));
  });

  app.post("/v1/plans/:id/publish", async (c) => {
    const req = validate<PublishRequest>("PublishRequest", await c.req.json());
    return c.json(await publishPlan(c.req.param("id"), req.version));
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

  app.get("/v1/experiments/:id/trajectory", async (c) => {
    const skuId = c.req.query("sku_id");
    const distId = c.req.query("dist_id");
    if (!skuId || !distId) throw new HTTPException(422, { message: "sku_id and dist_id are required" });
    const seedRaw = c.req.query("seed") ?? "1";
    if (!/^-?\d+$/.test(seedRaw)) throw new HTTPException(422, { message: "seed must be an integer" });
    const info = repo.getExperiment(c.req.param("id"));
    if (!info || info.status !== "done") throw new HTTPException(404, { message: "trajectory not ready" });
    const traj = await engine.trajectory(info.experiment_id, {
      sku_id: skuId, dist_id: distId, opening_state: openingState(c.req.query("opening_state")), seed: Number(seedRaw),
    });
    if (!traj) throw new HTTPException(404, { message: "no trajectory for this sku, distributor and seed" });
    return c.json(traj);
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

  // ------------------------------------------------------------------ sidebar assistant
  app.post("/v1/assistant", async (c) => {
    const req = validate<AssistantRequest>("AssistantRequest", await c.req.json());
    const plan = req.plan_id ? planOr404(req.plan_id) : null;
    const page: Page = req.page ?? "planning";
    const context: AssistantContext = req.context ?? {};
    let intent: Intent = { tool: "unknown" };
    try {
      const scenarioId = plan?.scenario_id ?? (await engine.scenarios())[0];
      const scenario = scenarioId ? await engine.scenario(scenarioId) : null;
      const dists = (scenario?.nodes ?? []).filter((n) => n.type === "distributor").map((n) => ({ dist_id: n.node_id, city: n.city }));
      const refs: ViewRefs = {
        places: (scenario?.nodes ?? []).map((n) => ({ node_id: n.node_id, type: n.type, city: n.city })),
        skus: (scenario?.skus ?? []).map((s) => ({ sku_id: s.sku_id, name: s.name })),
      };
      // Page tools first on pages other than planning. On planning the existing rules run first and navigation is the fallback.
      intent = (page !== "planning" ? matchView(req.message, page, refs) : null) ?? parseIntent(req.message, dists);
      if (intent.tool === "unknown") intent = matchNavigate(req.message, page) ?? intent;
      let source: "rules" | "ai" = "rules";
      // The rules matched nothing: let the model pick a tool from the fixed list (checked in model.ts).
      if (intent.tool === "unknown" && llm) {
        const routed = await routeWithModel(llm, req.message, dists, refs.skus, page);
        if (routed) {
          intent = routed;
          source = "ai";
        }
      }
      const askFirst = req.mode === "ask_first" && !req.confirm;
      const out = (VIEW_TOOLS.has(intent.tool) ? await runView(intent, page, context, req.message, refs, plan) : null)
        ?? await runTool(intent, plan, dists, askFirst, page, context);
      const res: AssistantResponse = {
        status: out.status, intent: intent.tool, reply: clip(out.reply), steps: out.steps,
        plan_id: plan?.plan_id ?? null, plan_version: out.plan_version ?? plan?.version ?? null,
        plan_status: out.plan_status ?? (plan ? plan.status ?? "DRAFT" : null),
        pending_action: out.pending_action ?? null, ui_action: out.ui_action ?? null, source: out.source ?? source,
      };
      return c.json(res);
    } catch (err) {
      console.error(err);
      const reason = err instanceof Error ? err.message : String(err);
      const steps: AssistantStep[] = intent.tool === "unknown"
        ? []
        : [{ tool: intent.tool, status: "failed", summary: clip(reason, 200), plan_id: plan?.plan_id ?? null, plan_version: plan?.version ?? null }];
      const res: AssistantResponse = {
        status: "failed", intent: intent.tool, reply: clip(`Could not complete that: ${reason}`), steps,
        plan_id: plan?.plan_id ?? null, plan_version: plan?.version ?? null, plan_status: plan ? plan.status ?? "DRAFT" : null,
        pending_action: null, ui_action: null, source: "rules",
      };
      return c.json(res);
    }
  });

  return app;
}
