"""Independent plan validator (PRD FR-05 acceptance, 8.5).

Must NOT import optimize.py or freight.py: every check is re-derived from the plan, the scenario, the
snapshot and the config, so a bug in the optimiser cannot hide itself. Runs on 100% of plans.

Checks (ViolationConstraint):
  lot_stock      cases per lot <= depot stock; lot exists at that depot for that SKU
  mrsl           RSL on arrival >= MRSL fraction x shelf life
  truck_kg/m3    each FTL truck's lines fit its class capacity
  storage        cases x m3 per distributor <= free storage
  credit         cases x invoice value per distributor <= credit available
  lock           C10 locks (fix / cap / min) on lot -> distributor
  missing_truck  every shipped line sits on exactly one truck or consignment that lists it
  missing_reason every shipped line has >= 1 reason code (engine plans)
Rejected or zero-case lines are ignored.
"""
from __future__ import annotations

import math
from collections import defaultdict

from dia_engine.config import get_config
from dia_types import (
    LineStatus, Lock, LockKind, Plan, Scenario, ShipMode, Snapshot, ValidationReport, Violation, ViolationConstraint,
)

TOL = 1e-6


def validate_plan(plan: Plan, scenario: Scenario, snapshot: Snapshot, locks: list[Lock] = (),
                  require_reasons: bool = True) -> ValidationReport:
    cfg = get_config()
    skus = {s.sku_id: s for s in scenario.skus}
    nodes = {n.node_id: n for n in scenario.nodes}
    lanes = {(l.from_id, l.to_id): l for l in scenario.lanes}
    lots = {l.lot_id: l for l in snapshot.depot_lots}
    out: list[Violation] = []

    def bad(kind: ViolationConstraint, entity: str, detail: str, excess: float = 0.0) -> None:
        out.append(Violation(constraint=kind, entity=entity, detail=detail, excess=round(float(excess), 6)))

    shipped = [l for l in plan.lines if l.cases > 0 and l.status is not LineStatus.REJECTED]
    used = defaultdict(float)
    m3_to = defaultdict(float)
    inr_to = defaultdict(float)
    arc = defaultdict(float)

    for l in shipped:
        sku = skus.get(l.sku_id)
        lot = lots.get(l.lot_id)
        if sku is None or lot is None or lot.sku_id != l.sku_id or lot.depot_id != l.from_id:
            bad(ViolationConstraint.LOT_STOCK, l.line_id, f"lot {l.lot_id} not held at {l.from_id} for {l.sku_id}", l.cases)
            continue
        used[l.lot_id] += l.cases
        m3_to[l.to_id] += l.cases * sku.m3_per_case
        inr_to[l.to_id] += l.cases * sku.price_inr
        arc[(l.lot_id, l.to_id)] += l.cases

        lane = lanes.get((l.from_id, l.to_id))
        lead = math.ceil(lane.lead_days_mean) if lane else 0
        node = nodes.get(l.to_id)
        frac = node.mrsl_fraction if node and node.mrsl_fraction is not None else cfg.planning.mrsl_fraction["GT"]
        rsl = (lot.expiry_date - l.ship_date).days - lead
        need = frac * sku.shelf_life_days
        if rsl + TOL < need:
            bad(ViolationConstraint.MRSL, l.line_id, f"{rsl} days of life on arrival < {need:.1f} required", need - rsl)

        if require_reasons and not l.reasons:
            bad(ViolationConstraint.MISSING_REASON, l.line_id, "no reason code")

    for lot_id, n in used.items():
        if n > lots[lot_id].qty_cases + TOL:
            bad(ViolationConstraint.LOT_STOCK, lot_id, f"{n:g} cases planned from {lots[lot_id].qty_cases:g} in stock",
                n - lots[lot_id].qty_cases)
    for j, m3 in m3_to.items():
        free = snapshot.storage_free_m3.get(j, math.inf)
        if m3 > free + TOL:
            bad(ViolationConstraint.STORAGE, j, f"{m3:.2f} m3 into {free:.2f} m3 free", m3 - free)
    for j, inr in inr_to.items():
        credit = snapshot.credit_available_inr.get(j, math.inf)
        if inr > credit + TOL:
            bad(ViolationConstraint.CREDIT, j, f"Rs {inr:,.0f} against Rs {credit:,.0f} available", inr - credit)

    for lk in locks:
        x = arc.get((lk.lot_id, lk.dist_id), 0.0)
        broken = ((lk.kind is LockKind.FIX and abs(x - lk.qty) > TOL)
                  or (lk.kind is LockKind.CAP and x > lk.qty + TOL)
                  or (lk.kind is LockKind.MIN and x < lk.qty - TOL))
        if broken:
            bad(ViolationConstraint.LOCK, f"{lk.lot_id}->{lk.dist_id}", f"{lk.kind.value} {lk.qty:g}, planned {x:g}",
                abs(x - lk.qty))

    # trucks: every shipped line on exactly one listed truck; FTL trucks within capacity
    by_id = {l.line_id: l for l in shipped}
    holders = defaultdict(list)
    for t in plan.trucks:
        for i in t.line_ids:
            holders[i].append(t.truck_id)
        if t.mode is ShipMode.FTL:
            if t.truck_class is None:
                bad(ViolationConstraint.MISSING_TRUCK, t.truck_id, "FTL truck without a truck class")
                continue
            cap = cfg.costs.ftl[t.truck_class.value]
            members = [by_id[i] for i in t.line_ids if i in by_id]
            kg = sum(l.cases * skus[l.sku_id].kg_per_case for l in members if l.sku_id in skus)
            m3 = sum(l.cases * skus[l.sku_id].m3_per_case for l in members if l.sku_id in skus)
            if kg > cap.kg + TOL:
                bad(ViolationConstraint.TRUCK_KG, t.truck_id, f"{kg:.1f} kg on a {cap.kg:g} kg truck", kg - cap.kg)
            if m3 > cap.m3 + TOL:
                bad(ViolationConstraint.TRUCK_M3, t.truck_id, f"{m3:.2f} m3 on a {cap.m3:g} m3 truck", m3 - cap.m3)
    for l in shipped:
        ref = l.truck_id if l.mode is ShipMode.FTL else l.consignment_id
        if not ref or holders.get(l.line_id) != [ref]:
            bad(ViolationConstraint.MISSING_TRUCK, l.line_id,
                f"line names {ref or 'no truck'} but is listed on {holders.get(l.line_id, [])}")

    return ValidationReport(ok=not out, violations=out)
