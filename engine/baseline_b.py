"""FR-10 Baseline B, nearest-depot (s, S) with FTL rounding (owner: Member A)."""
from __future__ import annotations

from engine.models import ForecastBundle, Plan, Scenario, Snapshot, TempClass


class BaselineB:
    """Order up to S when below s (service level on the engine's forecast), first-come-first-served
    in seed order from the nearest depot with stock; FEFO; loads >= 70% topped up to full, else PTL
    (use engine.freight)."""

    name = "baseline_b"

    def __init__(self, service_level: float = 0.95, seed: int = 0):
        self.service_level = service_level
        self.seed = seed

    def plan(self, scenario: Scenario, snapshot: Snapshot, forecast: ForecastBundle, temp_class: TempClass) -> Plan:
        raise NotImplementedError("Member A: FR-10")
