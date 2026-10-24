"""Window demand distributions, PRD section 6.6.1 (owner: M2; consumed by M1).

A window's demand is negative binomial with the window mean and variance (Poisson if var <= mean).
All functions are exact for that distribution; M1 linearises them into the C2 / C8 curves.

  NB parameterisation: n = mean^2 / (var - mean), p = mean / var  (scipy.stats.nbinom(n, p)).
"""
from __future__ import annotations

from datetime import date
from functools import lru_cache

import numpy as np
from scipy import stats

from dia_types import PairForecast


def window(pf: PairForecast, start: date, days: int) -> tuple[float, float]:
    """(mean, variance) of demand over [start, start + days). Days past the horizon reuse the last day."""
    offset = (start - pf.start).days
    if offset < 0 or days <= 0:
        raise ValueError("window must start on or after the forecast start and have days > 0")
    idx = [min(offset + i, len(pf.mean) - 1) for i in range(days)]
    return sum(pf.mean[i] for i in idx), sum(pf.var[i] for i in idx)


@lru_cache(maxsize=4096)
def window_dist(mean: float, var: float):
    """Frozen scipy distribution for window demand, or None when mean <= 0 (demand is surely 0)."""
    if mean <= 0:
        return None
    if var <= mean * (1 + 1e-9):
        return stats.poisson(mean)
    return stats.nbinom(mean * mean / (var - mean), mean / var)


def quantile(mean: float, var: float, q: float) -> float:
    """Smallest d with P(D <= d) >= q."""
    if not 0 <= q <= 1:
        raise ValueError("q must be in [0, 1]")
    d = window_dist(mean, var)
    return 0.0 if d is None else float(d.ppf(q))


def _below(d, x: float) -> float:
    """E[(x - D)+] = sum_{k <= floor(x)} (x - k) P(D = k)."""
    if x < 0:
        return 0.0
    k = np.arange(int(np.floor(x)) + 1)
    return float(np.sum((x - k) * d.pmf(k)))


def expected_shortfall(mean: float, var: float, z: float) -> float:
    """E[(D - z)+]: expected unmet demand with stock z (lost-sales curve C2). Convex, decreasing in z."""
    d = window_dist(mean, var)
    if d is None:
        return 0.0
    return max(0.0, mean - z + _below(d, z))


def expected_leftover(mean: float, var: float, q: float) -> float:
    """E[(q - D)+]: expected unsold stock from q units (expected-waste curve C8). Convex, increasing in q."""
    d = window_dist(mean, var)
    if d is None:
        return max(0.0, q)
    return _below(d, q)
