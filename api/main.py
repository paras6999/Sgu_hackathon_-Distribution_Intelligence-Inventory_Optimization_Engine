"""FR-16 Vitaran service API (owner: Member D). Run: uvicorn api.main:app --reload

Every request/response body is a model from engine.models, so the UI, the API and the engine
share one contract. Endpoint list and semantics: Architecture.md, "API".
"""
from __future__ import annotations

import csv
import hashlib
import io
from datetime import date, datetime, timezone

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from api.backend import get_backend
from engine import store
from engine.config import config_hash, get_config
from engine.models import (
    AssumptionRow, DispatchResponse, DispatchTruck, EngineSettings, ExperimentAccepted, ExperimentInfo,
    ExperimentRequest, ExperimentResults, ExperimentStatus, ForecastRequest, ForecastResponse, LineStatus, Message,
    Plan, PlanEvent, PlanRequest, PlanStatus, Proposal, ProposalStatus, PublishRequest, PublishResponse,
    ResponseAction, ResponseRequest, ResponseResult, Snapshot,
)
from engine.pipeline import PlanInvalid, diff_plans

app = FastAPI(title="Vitaran API", version="1.1")


@app.exception_handler(NotImplementedError)
async def _not_implemented(_: Request, exc: NotImplementedError) -> JSONResponse:
    return JSONResponse(status_code=501, content={"detail": f"not implemented yet: {exc}"})


@app.exception_handler(PlanInvalid)
async def _plan_invalid(_: Request, exc: PlanInvalid) -> JSONResponse:
    return JSONResponse(status_code=500, content={"detail": str(exc),
                                                  "violations": [v.model_dump() for v in exc.report.violations]})


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _plan_or_404(plan_id: str, version: int | None = None, conn=None) -> Plan:
    plan = store.load_plan(plan_id, version, conn)
    if plan is None:
        raise HTTPException(404, f"plan {plan_id} v{version or 'latest'} not found")
    return plan


# --------------------------------------------------------------------------- meta

@app.get("/v1/health")
def health() -> dict:
    return {"status": "ok", "fake_backend": get_backend().fake}


@app.get("/v1/scenarios", response_model=list[str])
def scenarios() -> list[str]:
    return get_backend().list_scenarios()


@app.get("/v1/assumptions", response_model=list[AssumptionRow])
def assumptions() -> list[AssumptionRow]:
    cfg = get_config()
    meta = cfg.assumptions
    rows: list[AssumptionRow] = []

    def walk(prefix: str, value) -> None:
        if isinstance(value, dict):
            for k, v in value.items():
                walk(f"{prefix}.{k}" if prefix else str(k), v)
            return
        m = meta.get(prefix)
        rows.append(AssumptionRow(parameter=prefix, value=value, unit=m.unit if m else None,
                                  source=m.source if m else None, rationale=m.rationale if m else None))

    walk("", cfg.model_dump(exclude={"assumptions"}))
    return rows


# --------------------------------------------------------------------------- J1 planning

@app.get("/v1/scenarios/{scenario_id}/snapshot", response_model=Snapshot)
def snapshot(scenario_id: str, as_of: date, opening_state: str = "imbalanced") -> Snapshot:
    return get_backend().snapshot(scenario_id, as_of, opening_state)


@app.post("/v1/forecasts", response_model=ForecastResponse)
def forecasts(req: ForecastRequest) -> ForecastResponse:
    be = get_backend()
    bundle = be.forecast(req.scenario_id, req.as_of, req.horizon_weeks * 7)
    return ForecastResponse(rows=bundle.weekly, metrics=be.backtest(req.scenario_id))


@app.post("/v1/plans", response_model=Plan)
def create_plan(req: PlanRequest, opening_state: str = "imbalanced") -> Plan:
    be = get_backend()
    scenario = be.load_scenario(req.scenario_id)
    snap = be.snapshot(req.scenario_id, req.as_of, opening_state)
    fc = be.forecast(req.scenario_id, req.as_of)
    settings = EngineSettings(weights=req.weights)
    if req.base_plan_id:
        base = _plan_or_404(req.base_plan_id)
        plan_id, version = base.plan_id, base.version + 1
    else:
        plan_id, version = store.new_plan_id(), 1
    plan = be.make_plan(scenario, snap, fc, req.temp_class, settings, req.locks, plan_id, version)
    with store.transaction() as conn:
        store.save_plan(plan, conn)
        if req.base_plan_id:
            store.log_event(PlanEvent(plan_id=plan_id, plan_version=version, dist_id=None, actor="planner",
                                      action="replan", ts=_now()), conn)
    return plan


@app.get("/v1/plans/{plan_id}", response_model=Plan)
def get_plan(plan_id: str, version: int | None = None) -> Plan:
    return _plan_or_404(plan_id, version)


@app.post("/v1/plans/{plan_id}/publish", response_model=PublishResponse)
def publish(plan_id: str, req: PublishRequest) -> PublishResponse:
    be = get_backend()
    plan = _plan_or_404(plan_id, req.version)
    scenario = be.load_scenario(plan.scenario_id)
    snap = be.snapshot(plan.scenario_id, plan.as_of)
    price = {s.sku_id: s.price_inr for s in scenario.skus}
    messages: list[Message] = []
    with store.transaction() as conn:
        plan.status = PlanStatus.PROPOSED
        store.save_plan(plan, conn)
        previous = {p.dist_id: p for p in store.get_proposals(plan_id, conn)}
        for dist in sorted({l.to_id for l in plan.lines}):
            pv = previous[dist].proposal_version + 1 if dist in previous else 1
            store.upsert_proposal(Proposal(plan_id=plan_id, dist_id=dist, proposal_version=pv,
                                           status=ProposalStatus.PROPOSED, sent_at=_now()), conn)
            messages.append(_message(plan, dist, pv, price, snap.credit_available_inr.get(dist, 0.0)))
        store.log_event(PlanEvent(plan_id=plan_id, plan_version=plan.version, dist_id=None, actor="planner",
                                  action="publish", ts=_now()), conn)
    return PublishResponse(plan_id=plan_id, version=plan.version, messages=messages)


def _message(plan: Plan, dist: str, pv: int, price: dict[str, float], credit: float) -> Message:
    lines = [l for l in plan.lines if l.to_id == dist]
    total = sum(l.cases * price[l.sku_id] for l in lines)
    text = (f"Vitaran proposal v{pv} for {dist}: {len(lines)} lines, "
            f"Rs {total:,.0f} against Rs {credit:,.0f} credit available.")
    return Message(dist_id=dist, proposal_version=pv, text=text, line_ids=[l.line_id for l in lines],
                   total_value_inr=total, credit_available_inr=credit)


# --------------------------------------------------------------------------- J2 distributor loop

@app.get("/v1/plans/{plan_id}/proposals", response_model=list[Proposal])
def proposals(plan_id: str) -> list[Proposal]:
    return store.get_proposals(plan_id)


@app.get("/v1/plans/{plan_id}/inbox/{dist_id}", response_model=Message)
def inbox(plan_id: str, dist_id: str) -> Message:
    be = get_backend()
    plan = _plan_or_404(plan_id)
    prop = next((p for p in store.get_proposals(plan_id) if p.dist_id == dist_id), None)
    if prop is None:
        raise HTTPException(404, f"no proposal for {dist_id}; publish the plan first")
    scenario = be.load_scenario(plan.scenario_id)
    credit = be.snapshot(plan.scenario_id, plan.as_of).credit_available_inr.get(dist_id, 0.0)
    return _message(plan, dist_id, prop.proposal_version, {s.sku_id: s.price_inr for s in scenario.skus}, credit)


@app.post("/v1/plans/{plan_id}/responses", response_model=ResponseResult)
def respond(plan_id: str, req: ResponseRequest) -> ResponseResult:
    be = get_backend()
    with store.transaction() as conn:   # one response at a time (PRD 6.7)
        plan = _plan_or_404(plan_id, conn=conn)
        props = store.get_proposals(plan_id, conn)
        mine = next((p for p in props if p.dist_id == req.dist_id), None)
        if mine is None:
            raise HTTPException(404, f"no proposal for {req.dist_id}")
        if mine.proposal_version != req.proposal_version:
            raise HTTPException(409, f"stale proposal version {req.proposal_version}; current is {mine.proposal_version}")
        own = {l.line_id: l for l in plan.lines if l.to_id == req.dist_id}
        for a in req.actions:
            if a.line_id not in own:
                raise HTTPException(422, f"line {a.line_id} is not in {req.dist_id}'s current proposal")
            if a.action is ResponseAction.TRIM and (a.qty is None or not 0 <= a.qty <= own[a.line_id].cases):
                raise HTTPException(422, f"trim qty for {a.line_id} must be between 0 and {own[a.line_id].cases}")

        scenario = be.load_scenario(plan.scenario_id)
        snap = be.snapshot(plan.scenario_id, plan.as_of)
        fc = be.forecast(plan.scenario_id, plan.as_of)
        new = be.apply_response(plan, props, req, scenario, snap, fc)
        new.status = PlanStatus.PROPOSED
        store.save_plan(new, conn)

        diff = diff_plans(plan, new)
        grown = sorted({d.dist_id for d in diff if d.new_cases > d.old_cases and d.dist_id != req.dist_id})
        acts = {a.action for a in req.actions}
        status = (ProposalStatus.REJECTED if acts == {ResponseAction.REJECT} else
                  ProposalStatus.TRIMMED if ResponseAction.TRIM in acts else ProposalStatus.ACCEPTED)
        now = _now()
        store.upsert_proposal(mine.model_copy(update={"status": status, "responded_at": now}), conn)
        for p in props:
            if p.dist_id in grown:
                store.upsert_proposal(p.model_copy(update={"proposal_version": p.proposal_version + 1}), conn)
        delta = new.expected_kpis.total_inr - plan.expected_kpis.total_inr
        for a in req.actions:
            old_qty = own[a.line_id].cases
            new_qty = {ResponseAction.ACCEPT: old_qty, ResponseAction.TRIM: a.qty, ResponseAction.REJECT: 0}[a.action]
            store.log_event(PlanEvent(plan_id=plan_id, plan_version=new.version, dist_id=req.dist_id,
                                      actor=req.dist_id, action=a.action.value, line_id=a.line_id, old_qty=old_qty,
                                      new_qty=new_qty, delta_cost_inr=delta if a.action is not ResponseAction.ACCEPT else 0,
                                      ts=now), conn)
        for d in diff:
            if d.dist_id in grown:
                store.log_event(PlanEvent(plan_id=plan_id, plan_version=new.version, dist_id=d.dist_id, actor="engine",
                                          action="grow", line_id=d.line_id, old_qty=d.old_cases, new_qty=d.new_cases,
                                          ts=now), conn)
    return ResponseResult(plan_version=new.version, proposal_version=req.proposal_version, grown_proposals=grown,
                          line_diff=diff, delta_cost_inr=delta)


@app.get("/v1/plans/{plan_id}/events", response_model=list[PlanEvent])
def events(plan_id: str) -> list[PlanEvent]:
    return store.list_events(plan_id)


# --------------------------------------------------------------------------- J3 dispatch

@app.get("/v1/plans/{plan_id}/dispatch", response_model=DispatchResponse)
def dispatch(plan_id: str, depot: str | None = None, version: int | None = None) -> DispatchResponse:
    plan = _plan_or_404(plan_id, version)
    by_id = {l.line_id: l for l in plan.lines}
    trucks = []
    for t in plan.trucks:
        if depot and t.from_id != depot:
            continue
        lines = sorted((by_id[i] for i in t.line_ids if by_id[i].status is not LineStatus.REJECTED and by_id[i].cases > 0),
                       key=lambda l: (l.expiry, l.lot_id))   # FEFO pick order
        if lines:
            trucks.append(DispatchTruck(truck=t, lines=lines))
    return DispatchResponse(plan_id=plan_id, version=plan.version, depot_id=depot, trucks=trucks)


@app.get("/v1/plans/{plan_id}/dispatch.csv")
def dispatch_csv(plan_id: str, depot: str | None = None, version: int | None = None) -> Response:
    d = dispatch(plan_id, depot, version)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["truck_id", "mode", "truck_class", "from_id", "to_id", "ship_date", "kg_pct", "m3_pct",
                "line_id", "sku_id", "sku_name", "lot_id", "expiry", "cases"])
    for dt in d.trucks:
        t = dt.truck
        for l in dt.lines:
            w.writerow([t.truck_id, t.mode.value, t.truck_class.value if t.truck_class else "", t.from_id, t.to_id,
                        t.ship_date, f"{t.kg_pct:.1f}", f"{t.m3_pct:.1f}", l.line_id, l.sku_id, l.sku_name, l.lot_id,
                        l.expiry, l.cases])
    return Response(content="﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="dispatch_{plan_id}.csv"'})


# --------------------------------------------------------------------------- J4 evaluation

@app.post("/v1/experiments", status_code=202, response_model=ExperimentAccepted)
def start_experiment(req: ExperimentRequest, background: BackgroundTasks) -> ExperimentAccepted:
    h = hashlib.sha256((config_hash() + req.model_dump_json()).encode()).hexdigest()[:12]
    exp_id, cached = store.create_experiment(h)
    if not cached:
        background.add_task(get_backend().run_experiment, exp_id, req)
    return ExperimentAccepted(experiment_id=exp_id, cached=cached)


@app.get("/v1/experiments/{experiment_id}", response_model=ExperimentInfo)
def experiment(experiment_id: str) -> ExperimentInfo:
    info = store.get_experiment(experiment_id)
    if info is None:
        raise HTTPException(404, "experiment not found")
    return info


@app.get("/v1/experiments/{experiment_id}/results", response_model=ExperimentResults)
def experiment_results(experiment_id: str) -> ExperimentResults:
    info = store.get_experiment(experiment_id)
    if info is None or info.status is not ExperimentStatus.DONE:
        raise HTTPException(404, "results not ready")
    res = store.load_results(experiment_id)
    if res is None:
        raise HTTPException(404, "results file missing")
    return res
