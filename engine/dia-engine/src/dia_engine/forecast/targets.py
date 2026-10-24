"""FR-04 Order-up-to targets (owner: M2). Reported to planners; NOT imposed by the optimiser."""
from __future__ import annotations

from dia_types import EngineSettings, ForecastBundle, Scenario, Target, TempClass


def compute_targets(scenario: Scenario, forecast: ForecastBundle, temp_class: TempClass,
                    settings: EngineSettings = EngineSettings()) -> list[Target]:
    """S = mu(R+L) + z(CR) * sigma(R+L) per SKU x distributor of this temp class.

    settings.uniform_service_level -> CR = 0.95 for every SKU (ablation e).
    The ambient cover window includes the festival pre-build extension (PRD 6.6.1).
    """
    raise NotImplementedError("M2: FR-04")
