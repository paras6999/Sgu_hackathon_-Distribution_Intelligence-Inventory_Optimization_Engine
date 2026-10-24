"""Independent plan validator (owner: Member C; reviewer: Member A).

Must NOT import optimize.py: it re-derives every check from the inputs.
"""
from __future__ import annotations

from engine.models import Lock, Plan, Scenario, Snapshot, ValidationReport


def validate_plan(plan: Plan, scenario: Scenario, snapshot: Snapshot, locks: list[Lock] = (),
                  require_reasons: bool = True) -> ValidationReport:
    """Check lot stock, truck kg/m3, storage, credit, MRSL, locks, truck assignment and reason codes."""
    raise NotImplementedError("Member C")
