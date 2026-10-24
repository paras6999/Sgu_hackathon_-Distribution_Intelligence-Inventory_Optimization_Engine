"""KPIs and experiment summaries, PRD section 8 (owner: M1)."""
from __future__ import annotations

import pandas as pd

from dia_types import ExperimentResults, Scenario

# Contract: KpiSummary.kpi uses exactly these names (UI labels them).
KPI_NAMES = [
    "fill_rate", "festival_fill_rate", "stockout_rate", "lost_margin_inr", "wastage_inr",
    "freight_inr_per_case", "ftl_utilisation", "cost_to_serve_inr", "cover_extremes", "co2_kg_per_case",
]


def compute_kpis(sim_log: pd.DataFrame, sim_trips: pd.DataFrame, scenario: Scenario) -> pd.DataFrame:
    """One row per policy x opening_state x seed x kpi (store table 'kpi_results' columns)."""
    raise NotImplementedError("M1: PRD 8.2")


def summarise(experiment_id: str, kpi_results: pd.DataFrame) -> ExperimentResults:
    """Means, 90% paired-t CIs, delta vs better baseline per KPI, frontier and ablation rows."""
    raise NotImplementedError("M1: PRD 8.1")
