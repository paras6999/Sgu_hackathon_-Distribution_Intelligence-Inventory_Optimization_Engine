"""FR-05 Allocation MILP, PRD 6.6.3 (owner: M1). PuLP + HiGHS, CBC fallback."""
from __future__ import annotations

from dia_types import OptimizeInput, SolveOutput


class SolverFailed(RuntimeError):
    """Raised when no usable solution exists; pipeline falls back to Baseline B."""


def solve(inp: OptimizeInput) -> SolveOutput:
    """Return a Plan with lines and trucks (reasons empty) plus diagnostics for explain.py.

    Honour inp.settings ablation switches (no_expiry_term, no_truck_steps, no_credit,
    home_depot_only) and inp.locks (constraint C10).
    """
    raise NotImplementedError("M1: FR-05")
