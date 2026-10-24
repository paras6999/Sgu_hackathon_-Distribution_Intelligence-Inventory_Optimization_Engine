"""Window demand distributions, PRD section 6.6.1 (owner: M2; consumed by M1).

A window's demand is negative binomial with the window mean and variance (Poisson if var <= mean).
"""
from __future__ import annotations

from datetime import date

from dia_types import PairForecast


def window(pf: PairForecast, start: date, days: int) -> tuple[float, float]:
    """(mean, variance) of demand over [start, start + days). Days past the horizon reuse the last day."""
    offset = (start - pf.start).days
    if offset < 0 or days <= 0:
        raise ValueError("window must start on or after the forecast start and have days > 0")
    idx = [min(offset + i, len(pf.mean) - 1) for i in range(days)]
    return sum(pf.mean[i] for i in idx), sum(pf.var[i] for i in idx)


def quantile(mean: float, var: float, q: float) -> float:
    raise NotImplementedError("M2: negative binomial / Poisson quantile")


def expected_shortfall(mean: float, var: float, z: float) -> float:
    """E[(D - z)+], used for the lost-sales curve C2."""
    raise NotImplementedError("M2")


def expected_leftover(mean: float, var: float, q: float) -> float:
    """E[(q - D)+], used for the expected-waste curve C8."""
    raise NotImplementedError("M2")
