"""Policy interface used by the simulator (contract). Engine, Baseline A and Baseline B implement it."""
from __future__ import annotations

from typing import Protocol

from engine.models import ForecastBundle, Plan, Scenario, Snapshot, TempClass


class Policy(Protocol):
    name: str

    def plan(self, scenario: Scenario, snapshot: Snapshot, forecast: ForecastBundle,
             temp_class: TempClass) -> Plan:
        """Return a plan whose lines and trucks obey stock, truck, storage and credit limits."""
        ...
