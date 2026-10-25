"""FR-20 at-risk stock (owner: M1). Stock likely to expire before it sells, at depots and at distributors.

Distributor lots are listed when their shelf life runs out before the expected days to sell (stock / daily
demand), as PRD FR-20 defines it.
Depot lots are listed when they fall below the MRSL floor before the distributors of their depot can buy them
(days to floor < expected days to sell). Days to floor = days left - MRSL fraction x shelf life.
Expected expired cases come from the forecast demand over the days left (expected_leftover, forecast.dist).
Rows with at least 0.5 expected expired case get a move-or-discount action; the rest get "Watch".
"""
from __future__ import annotations

from datetime import date

from dia_engine.config import get_config
from dia_engine.forecast.dist import expected_leftover, window
from dia_types import AtRisk, ForecastBundle, Scenario, Snapshot

EXPIRY_THRESHOLD_CASES = 0.5
MAX_DAYS_TO_SELL = 999.0


def at_risk(scenario: Scenario, snapshot: Snapshot, forecast: ForecastBundle, as_of: date,
            limit: int = 100) -> list[AtRisk]:
    """At-risk lots, most expected expired cases first, at most `limit` rows."""
    pairs = {(pf.sku_id, pf.dist_id): pf for pf in forecast.pairs}
    nodes = {node.node_id: node for node in scenario.nodes}
    skus = {sku.sku_id: sku for sku in scenario.skus}
    rows = _distributor_rows(snapshot, as_of, pairs, nodes, skus)
    rows += _depot_rows(snapshot, as_of, pairs, nodes, skus)
    rows.sort(key=lambda r: r.expected_expired_cases, reverse=True)
    return rows[:limit]


def _distributor_rows(snapshot: Snapshot, as_of: date, pairs, nodes, skus) -> list[AtRisk]:
    rows: list[AtRisk] = []
    for stock in snapshot.dist_stock:
        if stock.lot_id is None or stock.qty_cases <= 0:
            continue
        pf = pairs.get((stock.sku_id, stock.dist_id))
        if pf is None:
            continue
        days_left = (stock.expiry_date - as_of).days
        span = max(days_left, 1)
        mu, var = window(pf, pf.start, span)
        expired = expected_leftover(mu, var, stock.qty_cases)
        daily = mu / span
        days_to_sell = _days_to_sell(stock.qty_cases, daily)
        if days_left > 0 and days_to_sell <= days_left:
            continue   # expected to sell before its shelf life runs out
        node = nodes[stock.dist_id]
        if days_left <= 0:
            action = "Already past expiry: write off or return"
        elif expired >= EXPIRY_THRESHOLD_CASES:
            action = _move_or_discount(pf, stock.dist_id, node.region, daily, pairs, nodes, span, stock.expiry_date)
        else:
            action = "Watch"
        rows.append(AtRisk(
            holder_type="distributor", dist_id=stock.dist_id, dist_city=node.city, sku_id=stock.sku_id,
            sku_name=skus[stock.sku_id].name, lot_id=stock.lot_id, expiry=stock.expiry_date, days_left=days_left,
            stock_cases=stock.qty_cases, daily_demand_cases=daily, expected_days_to_sell=days_to_sell,
            expected_expired_cases=expired, suggested_action=action))
    return rows


def _depot_rows(snapshot: Snapshot, as_of: date, pairs, nodes, skus) -> list[AtRisk]:
    """Depot lots that reach the MRSL floor before the depot's distributors can buy them."""
    cfg = get_config()
    rows: list[AtRisk] = []
    for lot in snapshot.depot_lots:
        sku = skus.get(lot.sku_id)
        if sku is None or lot.qty_cases < 1:
            continue
        served = [pf for (sku_id, dist_id), pf in pairs.items()
                  if sku_id == lot.sku_id and nodes[dist_id].home_depot_id == lot.depot_id]
        if not served:
            continue
        days_left = (lot.expiry_date - as_of).days
        span = max(days_left, 1)
        mu = sum(window(pf, pf.start, span)[0] for pf in served)
        var = sum(window(pf, pf.start, span)[1] for pf in served)
        daily = mu / span
        days_to_sell = _days_to_sell(lot.qty_cases, daily)
        depot = nodes[lot.depot_id]
        mrsl = depot.mrsl_fraction or cfg.planning.mrsl_fraction["GT"]
        days_to_floor = days_left - mrsl * sku.shelf_life_days
        if days_to_floor >= days_to_sell:
            continue   # the distributors can buy it before it reaches the floor
        if days_to_floor <= 0:
            action = "Below the shelf-life floor: no distributor will take it. Sell at a discount or write off"
        else:
            action = (f"Ship within {days_to_floor:.0f} days to the {len(served)} distributors this depot serves "
                      f"(they sell {daily:.1f}/day together)")
        rows.append(AtRisk(
            holder_type="depot", dist_id=lot.depot_id, dist_city=depot.city, sku_id=lot.sku_id, sku_name=sku.name,
            lot_id=lot.lot_id, expiry=lot.expiry_date, days_left=days_left, stock_cases=lot.qty_cases,
            daily_demand_cases=daily, expected_days_to_sell=days_to_sell,
            expected_expired_cases=expected_leftover(mu, var, lot.qty_cases), suggested_action=action))
    return rows


def _days_to_sell(qty: float, daily: float) -> float:
    if daily <= 1e-9:
        return MAX_DAYS_TO_SELL
    return min(qty / daily, MAX_DAYS_TO_SELL)


def _move_or_discount(pf, dist_id: str, region, daily: float, pairs, nodes, span: int, expiry: date) -> str:
    """Move to the same-region distributor with the highest daily demand for this SKU, else discount or return."""
    best = None
    for (sku_id, other_id), other in pairs.items():
        if sku_id != pf.sku_id or other_id == dist_id or nodes[other_id].region != region:
            continue
        other_daily = window(other, other.start, span)[0] / span
        if best is None or other_daily > best[1]:
            best = (other_id, other_daily)
    if best is None:
        return f"Discount or return before {expiry}"
    other_id, other_daily = best
    return (f"Move to {nodes[other_id].city} (sells {other_daily:.1f}/day vs {daily:.1f}/day here) "
            f"or discount before {expiry}")
