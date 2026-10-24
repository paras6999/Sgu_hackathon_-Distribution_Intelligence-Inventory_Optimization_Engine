"""FR-03 Demand forecast (owner: Member B).

Reads demand_daily (date < as_of only), events and weather_daily through engine.store.
Caches fitted parameters per scenario so the simulator can call forecast() every cycle cheaply.
"""
from __future__ import annotations

from datetime import date
from typing import Literal

from engine.models import BacktestMetrics, ForecastBundle


def forecast(scenario_id: str, as_of: date, horizon_days: int = 28,
             model: Literal["full", "seasonal_naive"] = "full") -> ForecastBundle:
    """Daily mean/var per SKU x distributor for horizon_days from as_of, plus weekly P10/P50/P90 rows."""
    raise NotImplementedError("Member B: FR-03")


def backtest(scenario_id: str) -> BacktestMetrics:
    """12 rolling-origin backtests on history; writes store table 'backtest'."""
    raise NotImplementedError("Member B: FR-03")
