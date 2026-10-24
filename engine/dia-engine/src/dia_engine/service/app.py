"""Internal engine HTTP service (owner: M1). Started by the backend; listens on 127.0.0.1 only.

The engine is stateless about plans: the backend sends ids, locks and the current plan, and stores the
result in its own SQLite. Contract models: dia_types (Engine* requests). Public API: apps/dia-backend.

Errors: NotImplementedError -> 501, PlanInvalid -> 422 with violations, unknown scenario -> 404.
"""
from __future__ import annotations

from datetime import date
from functools import lru_cache

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from dia_engine import __version__, store
from dia_engine.config import get_config
from dia_engine.data.generate import list_scenarios, load_scenario
from dia_engine.forecast.analysis import demand_history, learned_effects
from dia_engine.forecast.forecast import backtest, forecast
from dia_engine.optimize.pipeline import PlanInvalid, apply_response, make_plan
from dia_engine.sim.simulate import get_snapshot
from dia_types import (
    AssumptionRow, BacktestMetrics, EngineForecastRequest, EngineHealth, EnginePlanRequest, EngineResolveRequest,
    DemandHistory, ForecastBundle, ForecastMode, LearnedEffects, OpeningState, Plan, Scenario, Snapshot,
)

app = FastAPI(title="dia-engine (internal)", version=__version__)


@app.exception_handler(NotImplementedError)
async def _not_implemented(_: Request, exc: NotImplementedError) -> JSONResponse:
    return JSONResponse(status_code=501, content={"detail": f"not implemented yet: {exc}"})


@app.exception_handler(ValueError)
async def _bad_request(_: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.exception_handler(PlanInvalid)
async def _plan_invalid(_: Request, exc: PlanInvalid) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc),
                                                  "violations": [v.model_dump(mode="json") for v in exc.report.violations]})


@app.exception_handler(FileNotFoundError)
async def _missing(_: Request, exc: FileNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": f"not found: {exc}"})


@lru_cache(maxsize=32)
def _scenario(scenario_id: str) -> Scenario:
    return load_scenario(scenario_id)


@app.get("/health", response_model=EngineHealth)
def health() -> EngineHealth:
    return EngineHealth(status="ok", version=__version__, data_dir=str(store.data_dir()))


@app.get("/scenarios", response_model=list[str])
def scenarios() -> list[str]:
    return list_scenarios()


@app.get("/scenarios/{scenario_id}", response_model=Scenario)
def scenario(scenario_id: str) -> Scenario:
    return _scenario(scenario_id)


@app.get("/scenarios/{scenario_id}/snapshot", response_model=Snapshot)
def snapshot(scenario_id: str, as_of: date, opening_state: OpeningState = OpeningState.IMBALANCED) -> Snapshot:
    return get_snapshot(scenario_id, as_of, opening_state)


@app.get("/scenarios/{scenario_id}/backtest", response_model=BacktestMetrics)
def scenario_backtest(scenario_id: str) -> BacktestMetrics:
    return backtest(scenario_id)


@app.get("/scenarios/{scenario_id}/history", response_model=DemandHistory)
def history(scenario_id: str, dist_id: str | None = None, sku_id: str | None = None) -> DemandHistory:
    return demand_history(scenario_id, dist_id or None, sku_id or None)


@app.get("/scenarios/{scenario_id}/effects", response_model=LearnedEffects)
def effects(scenario_id: str) -> LearnedEffects:
    return learned_effects(scenario_id)


@app.post("/forecast", response_model=ForecastBundle)
def post_forecast(req: EngineForecastRequest) -> ForecastBundle:
    return forecast(req.scenario_id, req.as_of, req.horizon_days, ForecastMode(req.model).value)


@app.post("/plan", response_model=Plan)
def post_plan(req: EnginePlanRequest) -> Plan:
    sc = _scenario(req.scenario_id)
    snap = get_snapshot(req.scenario_id, req.as_of, req.opening_state)
    fc = forecast(req.scenario_id, req.as_of, 28, ForecastMode(req.settings.forecast_model).value)
    return make_plan(sc, snap, fc, req.temp_class, plan_id=req.plan_id, settings=req.settings,
                     locks=req.locks, version=req.version)


@app.post("/resolve", response_model=Plan)
def post_resolve(req: EngineResolveRequest) -> Plan:
    p = req.plan
    sc = _scenario(p.scenario_id)
    snap = get_snapshot(p.scenario_id, p.as_of, req.opening_state)
    fc = forecast(p.scenario_id, p.as_of, 28, ForecastMode(p.settings.forecast_model).value)
    return apply_response(p, req.proposals, req.response, sc, snap, fc)


def assumption_rows() -> list[AssumptionRow]:
    cfg = get_config()
    meta = cfg.assumptions
    rows: list[AssumptionRow] = []

    def walk(prefix: str, value) -> None:
        m = meta.get(prefix)
        if isinstance(value, dict) and m is None:
            for k, v in value.items():
                walk(f"{prefix}.{k}" if prefix else str(k), v)
            return
        rows.append(AssumptionRow(parameter=prefix, value=value, unit=m.unit if m else None,
                                  source=m.source if m else None, rationale=m.rationale if m else None))

    walk("", cfg.model_dump(mode="json", exclude={"assumptions"}))
    return rows


@app.get("/assumptions", response_model=list[AssumptionRow])
def assumptions() -> list[AssumptionRow]:
    return assumption_rows()
