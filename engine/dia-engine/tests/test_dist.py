"""Window distribution checks (PRD 8.5: curves within 2% of mean window demand vs Monte Carlo)."""
from __future__ import annotations

import numpy as np
import pytest

from dia_engine.forecast.dist import expected_leftover, expected_shortfall, quantile, window_dist

CASES = [(3.0, 2.5), (12.0, 30.0), (60.0, 400.0), (250.0, 2000.0)]   # Poisson branch + NB, low to high volume


def _draws(mean: float, var: float, n: int = 400_000) -> np.ndarray:
    return window_dist(mean, var).rvs(size=n, random_state=np.random.default_rng(7))


@pytest.mark.parametrize("mean,var", CASES)
def test_moments_match(mean, var):
    d = window_dist(mean, var)
    assert d.mean() == pytest.approx(mean)
    assert d.var() == pytest.approx(max(var, mean))


@pytest.mark.parametrize("mean,var", CASES)
def test_partial_expectations_vs_monte_carlo(mean, var):
    x = _draws(mean, var)
    for q in (0.0, 0.25, 0.5, 0.9, 0.98):
        z = quantile(mean, var, q)
        assert abs(expected_shortfall(mean, var, z) - np.maximum(x - z, 0).mean()) <= 0.02 * mean
        assert abs(expected_leftover(mean, var, z) - np.maximum(z - x, 0).mean()) <= 0.02 * mean


@pytest.mark.parametrize("mean,var", CASES)
def test_identity_and_shape(mean, var):
    # E[(D-z)+] - E[(z-D)+] = mean - z; shortfall decreasing, leftover increasing.
    zs = [quantile(mean, var, q) for q in (0.1, 0.5, 0.9)] + [mean * 0.7 + 0.3]
    for z in zs:
        assert expected_shortfall(mean, var, z) - expected_leftover(mean, var, z) == pytest.approx(mean - z, abs=1e-6)
    s = [expected_shortfall(mean, var, z) for z in sorted(zs)]
    assert s == sorted(s, reverse=True)


def test_edge_cases():
    assert expected_shortfall(50.0, 80.0, 0.0) == pytest.approx(50.0)
    assert expected_leftover(50.0, 80.0, 0.0) == 0.0
    assert quantile(0.0, 0.0, 0.9) == 0.0
    assert expected_shortfall(0.0, 0.0, 5.0) == 0.0 and expected_leftover(0.0, 0.0, 5.0) == 5.0
    assert expected_leftover(10.0, 20.0, -1.0) == 0.0
    with pytest.raises(ValueError):
        quantile(10.0, 20.0, 1.5)
