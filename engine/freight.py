"""Freight costs and load build, PRD 6.5 step 7 (owner: Member C).

Shared by the engine AND both baselines so every policy pays identical freight.
"""
from __future__ import annotations

from datetime import date

from engine.models import Lane, PlanLine, Scenario, Truck, TruckClass


def ftl_trip_cost(lane: Lane, truck_class: TruckClass, ship_date: date) -> float:
    """Trip cost including the festival premium (config costs.festival_freight_premium)."""
    raise NotImplementedError("Member C")


def ptl_cost(lane: Lane, kg: float, m3: float, ship_date: date) -> float:
    """max(min charge, rate x chargeable kg), chargeable kg = max(kg, kg_per_m3 x m3)."""
    raise NotImplementedError("Member C")


def build_loads(lines: list[PlanLine], ftl_trips: dict[tuple[str, str, TruckClass], int],
                scenario: Scenario) -> tuple[list[PlanLine], list[Truck]]:
    """Assign lines to trucks (first-fit decreasing, split lines if needed), set truck_id /
    consignment_id and freight_alloc_inr. Returns (lines, trucks); lines may be split."""
    raise NotImplementedError("Member C")
