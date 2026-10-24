"""FR-10 Baseline A, proportional fair share (owner: Member B)."""
from __future__ import annotations

from engine.models import ForecastBundle, Plan, Scenario, Snapshot, TempClass


class BaselineA:
    """Home depot splits stock across its region's distributors by trailing 4-week sales,
    capped at target cover; FIFO issue; cheaper of FTL/PTL per lane (use engine.freight)."""

    name = "baseline_a"

    def __init__(self, cover_days: int = 14):
        self.cover_days = cover_days

    def plan(self, scenario: Scenario, snapshot: Snapshot, forecast: ForecastBundle, temp_class: TempClass) -> Plan:
        raise NotImplementedError("Member B: FR-10")
