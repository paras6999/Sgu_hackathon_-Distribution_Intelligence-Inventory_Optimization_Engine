"""FR-06 Reason codes, PRD 6.6.4 (owner: M1)."""
from __future__ import annotations

from dia_types import OptimizeInput, Plan, SolveOutput


def add_reasons(out: SolveOutput, inp: OptimizeInput) -> Plan:
    """Fill 1-2 reasons per line (ordered by INR impact) and the shortfall rows. Every line gets >= 1 code."""
    raise NotImplementedError("M1: FR-06")
