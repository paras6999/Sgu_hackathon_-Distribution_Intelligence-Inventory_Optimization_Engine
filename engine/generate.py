"""FR-01 Scenario generator (owner: Member A).

Writes the scenario tables listed in store.TABLES (nodes, skus, lanes, lots, plant_receipts,
demand_daily, events) for one seed. demand_daily covers history AND the test window; the
forecaster must only read rows with date < as_of (Rules.md).
"""
from __future__ import annotations

from engine.config import Config
from engine.models import Scenario


def scenario_id_for(seed: int) -> str:
    return f"seed{seed:02d}"


def generate(cfg: Config, seed: int) -> str:
    """Build and persist one scenario. Same cfg + seed must give identical parquet hashes. Returns scenario_id."""
    raise NotImplementedError("Member A: FR-01")


def load_scenario(scenario_id: str) -> Scenario:
    """Read nodes, skus and lanes from parquet into the Scenario contract."""
    raise NotImplementedError("Member A: FR-01")


def list_scenarios() -> list[str]:
    """Scenario ids present under data/."""
    raise NotImplementedError("Member A: FR-01")
