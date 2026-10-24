"""Planning pipeline glue (owner: M1). The ONE entry point the engine service and the simulator call.

    forecast (M2) -> targets (M2) -> optimize (M1) -> explain (M1) -> validate (M1) -> Plan

Nobody else calls optimize/validate/explain directly, so the order and the fallback live here only.
"""
from __future__ import annotations

from collections import defaultdict

from dia_engine.baselines.baseline_b import BaselineB
from dia_engine.forecast import targets
from dia_engine.optimize import explain, optimize, validate
from dia_types import (
    EngineSettings, ForecastBundle, LineDiff, LineStatus, Lock, LockKind, OptimizeInput, Plan, Proposal,
    ProposalStatus, ResponseAction, ResponseRequest, Scenario, Snapshot, SolveStatus, TempClass, ValidationReport,
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


def _pair_qty(plan: Plan) -> dict[tuple[str, str], int]:
    """(lot, distributor) -> cases; a lot split across trucks has several lines."""
    out: dict[tuple[str, str], int] = defaultdict(int)
    for l in plan.lines:
        out[(l.lot_id, l.to_id)] += l.cases
    return out


def locks_for_response(plan: Plan, proposals: list[Proposal], req: ResponseRequest) -> list[Lock]:
    """Constraint C10 (PRD FR-08): responder's accepted lines fixed, trimmed lines capped, rejected lines
    fixed at 0; other responded distributors fixed at current qty; unresponded distributors min = current qty.
    A line the responder does not mention counts as accepted. Lines of one lot split across trucks add up."""
    status = {p.dist_id: p.status for p in proposals}
    acts = {a.line_id: a for a in req.actions}
    trimmed: set[tuple[str, str]] = set()
    new_qty: dict[tuple[str, str], int] = defaultdict(int)
    for l in plan.lines:
        key = (l.lot_id, l.to_id)
        if l.to_id != req.dist_id:
            continue
        a = acts.get(l.line_id)
        if a is None or a.action == ResponseAction.ACCEPT:
            new_qty[key] += l.cases
        elif a.action == ResponseAction.TRIM:
            new_qty[key] += min(max(a.qty or 0, 0), l.cases)
            trimmed.add(key)
        else:
            new_qty[key] += 0
    locks: list[Lock] = []
    for (lot, dist), qty in sorted(_pair_qty(plan).items()):
        if dist == req.dist_id:
            kind = LockKind.CAP if (lot, dist) in trimmed else LockKind.FIX
            locks.append(Lock(lot_id=lot, dist_id=dist, kind=kind, qty=float(new_qty[(lot, dist)])))
        elif status.get(dist, ProposalStatus.PROPOSED) == ProposalStatus.PROPOSED:
            locks.append(Lock(lot_id=lot, dist_id=dist, kind=LockKind.MIN, qty=float(qty)))
        else:
            locks.append(Lock(lot_id=lot, dist_id=dist, kind=LockKind.FIX, qty=float(qty)))
    return locks


def apply_response(plan: Plan, proposals: list[Proposal], req: ResponseRequest, scenario: Scenario,
                   snapshot: Snapshot, forecast: ForecastBundle) -> Plan:
    """Locked re-solve. Returns version plan.version + 1 with line statuses set for the responder."""
    locks = locks_for_response(plan, proposals, req)
    status = {p.dist_id: p.status for p in proposals}
    responded = {d for d, st in status.items() if st != ProposalStatus.PROPOSED} | {req.dist_id}
    # responded distributors are untouched: no new lot may reach them
    have = {(k.lot_id, k.dist_id) for k in locks}
    skus = {s.sku_id for s in scenario.skus if s.temp_class == plan.temp_class}
    for lot in snapshot.depot_lots:
        if lot.sku_id in skus:
            for d in responded:
                if (lot.lot_id, d) not in have:
                    locks.append(Lock(lot_id=lot.lot_id, dist_id=d, kind=LockKind.CAP, qty=0.0))
    new = make_plan(scenario, snapshot, forecast, plan.temp_class, plan_id=plan.plan_id, settings=plan.settings,
                    locks=locks, version=plan.version + 1)

    # statuses and proposal versions follow (lot, distributor), because line ids are renumbered
    before, after = _pair_qty(plan), _pair_qty(new)
    acts = {a.line_id: a for a in req.actions}
    trimmed = {(l.lot_id, l.to_id) for l in plan.lines
               if l.to_id == req.dist_id and (a := acts.get(l.line_id)) and a.action == ResponseAction.TRIM}
    old_status = {(l.lot_id, l.to_id): l.status for l in plan.lines}
    old_pv = {l.to_id: l.proposal_version for l in plan.lines}
    grown = {d for (lot, d), q in after.items() if d != req.dist_id and q > before.get((lot, d), 0)}
    lines = []
    for l in new.lines:
        key = (l.lot_id, l.to_id)
        if l.to_id == req.dist_id:
            st = LineStatus.TRIMMED if key in trimmed else LineStatus.ACCEPTED
        elif l.to_id in responded:
            st = old_status.get(key, LineStatus.ACCEPTED)
        else:
            st = LineStatus.PROPOSED
        pv = old_pv.get(l.to_id, 1) + (1 if l.to_id in grown else 0)
        lines.append(l.model_copy(update={"status": st, "proposal_version": pv}))
    return new.model_copy(update={"lines": lines})


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
