"""Planning pipeline glue (owner: M1). The ONE entry point the engine service and the simulator call.

    forecast (M2) -> targets (M2) -> optimize (M1) -> explain (M1) -> validate (M1) -> Plan

Nobody else calls optimize/validate/explain directly, so the order and the fallback live here only.
"""
from __future__ import annotations

from dia_engine.baselines.baseline_b import BaselineB
from dia_engine.forecast import targets
from dia_engine.optimize import explain, optimize, validate
from dia_types import (
    EngineSettings, ForecastBundle, LineDiff, Lock, OptimizeInput, Plan, Proposal, ResponseRequest, Scenario,
    Snapshot, SolveStatus, TempClass, ValidationReport,
)


class PlanInvalid(RuntimeError):
    def __init__(self, report: ValidationReport):
        super().__init__(f"{len(report.violations)} validator violations: {report.violations[:3]}")
        self.report = report


def make_plan(scenario: Scenario, snapshot: Snapshot, forecast: ForecastBundle, temp_class: TempClass,
              plan_id: str, settings: EngineSettings | None = None, locks: list[Lock] = (),
              version: int = 1) -> Plan:
    """plan_id and version come from the caller (the backend owns plan identity)."""
    settings = settings or EngineSettings()
    tg = targets.compute_targets(scenario, forecast, temp_class, settings)
    inp = OptimizeInput(scenario=scenario, snapshot=snapshot, forecast=forecast, targets=tg, temp_class=temp_class,
                        settings=settings, locks=list(locks), plan_id=plan_id, version=version)
    try:
        out = optimize.solve(inp)
    except optimize.SolverFailed:
        # PRD 6.7: use Baseline B for this cycle and flag it in the UI.
        plan = BaselineB().plan(scenario, snapshot, forecast, temp_class)
        plan = plan.model_copy(update={"plan_id": plan_id, "version": version,
                                       "solve": plan.solve.model_copy(update={"status": SolveStatus.FALLBACK_BASELINE_B})})
        report = validate.validate_plan(plan, scenario, snapshot, locks, require_reasons=False)
        if not report.ok:
            raise PlanInvalid(report)
        return plan
    plan = explain.add_reasons(out, inp)
    report = validate.validate_plan(plan, scenario, snapshot, locks)
    if not report.ok:
        raise PlanInvalid(report)
    return plan


class EnginePolicy:
    """Policy adapter so the simulator runs the engine exactly like the API does."""

    def __init__(self, name: str = "engine", settings: EngineSettings | None = None):
        self.name = name
        self.settings = settings or EngineSettings()

    def plan(self, scenario: Scenario, snapshot: Snapshot, forecast: ForecastBundle, temp_class: TempClass) -> Plan:
        return make_plan(scenario, snapshot, forecast, temp_class,
                         plan_id=f"SIM-{self.name}-{snapshot.as_of:%Y%m%d}-{temp_class.value}",
                         settings=self.settings)


def locks_for_response(plan: Plan, proposals: list[Proposal], req: ResponseRequest) -> list[Lock]:
    """Constraint C10 (PRD FR-08): responder's accepted lines fixed, trimmed lines capped, rejected lines
    fixed at 0; other responded distributors fixed at current qty; unresponded distributors min = current qty."""
    raise NotImplementedError("M1: FR-08 locks")


def apply_response(plan: Plan, proposals: list[Proposal], req: ResponseRequest, scenario: Scenario,
                   snapshot: Snapshot, forecast: ForecastBundle) -> Plan:
    """Locked re-solve. Returns version plan.version + 1 with line statuses set for the responder."""
    raise NotImplementedError("M1: FR-08 re-solve")


def diff_plans(old: Plan, new: Plan) -> list[LineDiff]:
    """Per (distributor, SKU, lot) change in cases between two versions."""
    def totals(p: Plan) -> dict[tuple[str, str, str], tuple[str, int]]:
        acc: dict[tuple[str, str, str], tuple[str, int]] = {}
        for l in p.lines:
            key = (l.to_id, l.sku_id, l.lot_id)
            acc[key] = (l.line_id, acc.get(key, ("", 0))[1] + l.cases)
        return acc

    a, b = totals(old), totals(new)
    out = []
    for key in sorted(set(a) | set(b)):
        old_c, new_c = a.get(key, ("", 0))[1], b.get(key, ("", 0))[1]
        if old_c != new_c:
            out.append(LineDiff(line_id=(b.get(key) or a.get(key))[0], dist_id=key[0], old_cases=old_c, new_cases=new_c))
    return out
