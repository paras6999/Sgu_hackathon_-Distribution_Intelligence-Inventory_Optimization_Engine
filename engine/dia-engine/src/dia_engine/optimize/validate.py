"""Independent plan validator (owner: M1; reviewer: M2).

Must NOT import optimize.py: it re-derives every check from the inputs.
"""
from __future__ import annotations

from dia_types import Lock, Plan, Scenario, Snapshot, ValidationReport


def validate_plan(plan: Plan, scenario: Scenario, snapshot: Snapshot, locks: list[Lock] = (),
                  require_reasons: bool = True) -> ValidationReport:
    """Check lot stock, truck kg/m3, storage, credit, MRSL, locks, truck assignment and reason codes."""
    raise NotImplementedError("M1")
