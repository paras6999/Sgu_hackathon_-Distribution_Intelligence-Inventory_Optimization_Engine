"""FR-20 at-risk stock (owner: M1). Distributor lots that are likely to expire before they sell.

For each distributor lot with stock, demand over the days left (from the forecast) gives the expected
expired cases (expected_leftover from forecast.dist). A lot is listed when it is expected to leave at least
0.5 case unsold, or when its expiry has passed.
"""
from __future__ import annotations

from datetime import date

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
        if expired < EXPIRY_THRESHOLD_CASES and days_left > 0:
            continue
        daily = mu / span
        node = nodes[stock.dist_id]
        if days_left <= 0:
            action = "Already past expiry: write off or return"
        elif expired >= EXPIRY_THRESHOLD_CASES:
            action = _move_or_discount(pf, stock.dist_id, node.region, daily, pairs, nodes, span, stock.expiry_date)
        else:
            action = "Watch"
        rows.append(AtRisk(
            dist_id=stock.dist_id, dist_city=node.city, sku_id=stock.sku_id, sku_name=skus[stock.sku_id].name,
            lot_id=stock.lot_id, expiry=stock.expiry_date, days_left=days_left, stock_cases=stock.qty_cases,
            daily_demand_cases=daily, expected_days_to_sell=_days_to_sell(stock.qty_cases, daily),
            expected_expired_cases=expired, suggested_action=action))
    rows.sort(key=lambda r: r.expected_expired_cases, reverse=True)
    return rows[:limit]


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
