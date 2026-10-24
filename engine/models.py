"""Shared data contracts (pydantic v2) used by engine, simulation, API and UI.

CONTRACT FILE: every member depends on it. Change it only through a
"contract change" PR approved by the members who consume the changed model
(see Team.md). Adding an optional field with a default is safe; renaming or
removing a field is not.

Units: money in INR, quantities in cases, weight in kg, volume in m3, time in days.
"""
from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- enums

class TempClass(str, Enum):
    AMBIENT = "ambient"
    CHILLED = "chilled"


class NodeType(str, Enum):
    DEPOT = "depot"
    DISTRIBUTOR = "distributor"


class TruckClass(str, Enum):
    AMB32 = "AMB32"    # 32 ft SXL, ambient
    REEF17 = "REEF17"  # 17 ft reefer, chilled


class ShipMode(str, Enum):
    FTL = "FTL"
    PTL = "PTL"


class ReasonCode(str, Enum):
    CHEAPEST_SOURCE = "CHEAPEST_SOURCE"
    EXPIRY_PUSH = "EXPIRY_PUSH"
    CLIFF_RESCUE = "CLIFF_RESCUE"
    FTL_TOPUP = "FTL_TOPUP"
    FESTIVAL_UPLIFT = "FESTIVAL_UPLIFT"
    WEATHER_SHIFT = "WEATHER_SHIFT"
    STOCK_LIMITED = "STOCK_LIMITED"
    CREDIT_LIMITED = "CREDIT_LIMITED"
    STORAGE_LIMITED = "STORAGE_LIMITED"
    MRSL_BLOCKED = "MRSL_BLOCKED"
    FAIR_SHARE_FLOOR = "FAIR_SHARE_FLOOR"


class PlanStatus(str, Enum):
    DRAFT = "DRAFT"
    PROPOSED = "PROPOSED"
    FINAL = "FINAL"


class LineStatus(str, Enum):
    PROPOSED = "PROPOSED"
    ACCEPTED = "ACCEPTED"
    TRIMMED = "TRIMMED"
    REJECTED = "REJECTED"


class ProposalStatus(str, Enum):
    PROPOSED = "PROPOSED"
    ACCEPTED = "ACCEPTED"
    TRIMMED = "TRIMMED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"


class ResponseAction(str, Enum):
    ACCEPT = "accept"
    TRIM = "trim"
    REJECT = "reject"


class ExperimentStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


OpeningState = Literal["neutral", "imbalanced"]
PolicyName = Literal[
    "engine", "baseline_a", "baseline_b",
    "abl_no_expiry", "abl_no_truck_steps", "abl_naive_forecast",
    "abl_no_credit", "abl_uniform_service", "abl_home_depot",
]


# --------------------------------------------------------------------------- master data (Member A)

class Node(Contract):
    node_id: str                      # e.g. "W1-Bhiwandi", "D09-Bengaluru"
    type: NodeType
    city: str
    region: Literal["N", "S", "E", "W"]
    lat: float
    lon: float
    storage_m3: float | None = None   # distributors only
    credit_limit_inr: float | None = None
    mrsl_fraction: float | None = None
    home_depot_id: str | None = None


class Sku(Contract):
    sku_id: str                       # e.g. "DY-03"
    name: str
    category: str
    temp_class: TempClass
    shelf_life_days: int
    kg_per_case: float
    m3_per_case: float
    price_inr: float                  # invoice value per case
    landed_cost_inr: float
    margin_inr: float
    disposal_inr: float


class Lane(Contract):
    from_id: str
    to_id: str
    km: float
    lead_days_mean: float
    p_delay: float
    ftl_cost_inr: dict[TruckClass, float]   # per trip, before festival premium
    ptl_rate_inr_per_kg: float
    ptl_min_charge_inr: float
    co2_kg_per_trip: dict[TruckClass, float]


class Lot(Contract):
    lot_id: str
    sku_id: str
    depot_id: str
    qty_cases: float
    mfg_date: date
    expiry_date: date


class Scenario(Contract):
    scenario_id: str                  # e.g. "seed01"
    seed: int
    nodes: list[Node]
    skus: list[Sku]
    lanes: list[Lane]


# --------------------------------------------------------------------------- state (Member A)

class DistStock(Contract):
    dist_id: str
    sku_id: str
    lot_id: str | None
    qty_cases: float
    expiry_date: date


class InTransit(Contract):
    to_id: str
    sku_id: str
    lot_id: str
    qty_cases: float
    eta: date
    expiry_date: date


class Snapshot(Contract):
    scenario_id: str
    as_of: date
    depot_lots: list[Lot]
    dist_stock: list[DistStock]
    in_transit: list[InTransit]
    credit_available_inr: dict[str, float]   # dist_id -> INR
    storage_free_m3: dict[str, float]        # dist_id -> m3


# --------------------------------------------------------------------------- forecast & targets (Member B)

class PairForecast(Contract):
    """Daily demand distribution for one SKU x distributor from `start` for len(mean) days.

    Window demand over any span = sum of daily means / variances (days independent, A27).
    Convert to a distribution with engine.dist.window_dist().
    """
    sku_id: str
    dist_id: str
    start: date
    mean: list[float]
    var: list[float]
    festival: list[float]             # daily multiplicative factors, for reason codes
    weather: list[float]
    promo: list[float]
    model: Literal["AutoETS", "TSB", "SeasonalNaive"]


class ForecastRow(Contract):
    """Weekly row for the UI and backtest report."""
    sku_id: str
    dist_id: str
    week_start: date
    p10: float
    p50: float
    p90: float
    model: str
    factors: dict[str, float]         # e.g. {"Diwali": 1.45, "heat": 1.08}


class ForecastBundle(Contract):
    scenario_id: str
    as_of: date
    horizon_days: int
    pairs: list[PairForecast]
    weekly: list[ForecastRow] = []


class BacktestMetrics(Contract):
    wape: float
    wape_seasonal_naive: float
    bias: float
    coverage_p10_p90: float
    wape_festival_weeks: float


class Target(Contract):
    sku_id: str
    dist_id: str
    S: float
    critical_ratio: float
    z: float
    cover_days: int
    mu: float
    sigma: float


# --------------------------------------------------------------------------- plan (Member C)

class Weights(Contract):
    pi_mult: float = 1.0              # stockout-penalty multiplier (frontier sweep)
    omega_mult: float = 1.0           # expiry-penalty multiplier
    carbon_inr_per_kg: float = 0.0    # P1, FR-13


class EngineSettings(Contract):
    """Weights plus ablation switches (FR-12). Default = full engine."""
    weights: Weights = Weights()
    no_expiry_term: bool = False          # (a)  owner C
    no_truck_steps: bool = False          # (b)  owner C
    forecast_model: Literal["full", "seasonal_naive"] = "full"   # (c) owner B
    no_credit: bool = False               # (d)  owner C
    uniform_service_level: bool = False   # (e)  owner B (targets) + C (pi)
    home_depot_only: bool = False         # (f)  owner C
    time_limit_s: float = 30.0
    mip_gap: float = 0.01


class Lock(Contract):
    """Constraint C10 on one arc (lot -> distributor)."""
    lot_id: str
    dist_id: str
    kind: Literal["fix", "cap", "min"]    # x == qty | x <= qty | x >= qty
    qty: float


class Reason(Contract):
    code: ReasonCode
    detail: str
    impact_inr: float = 0.0


class PlanLine(Contract):
    line_id: str                      # "PL-<plan>-v<version>-<nnn>"
    sku_id: str
    sku_name: str
    lot_id: str
    expiry: date
    from_id: str
    to_id: str
    cases: int
    mode: ShipMode
    truck_id: str | None = None       # FTL
    consignment_id: str | None = None # PTL
    truck_class: TruckClass | None = None
    ship_date: date
    eta: date
    rsl_on_arrival_days: int
    freight_alloc_inr: float
    reasons: list[Reason] = []
    proposal_version: int = 1
    status: LineStatus = LineStatus.PROPOSED


class Shortfall(Contract):
    """Demand left unserved (FR-06: rows with zero shipment and a limiting code)."""
    sku_id: str
    dist_id: str
    short_cases: float
    reasons: list[Reason] = []


class Truck(Contract):
    truck_id: str                     # FTL truck id or PTL consignment id
    mode: ShipMode
    truck_class: TruckClass | None
    from_id: str
    to_id: str
    ship_date: date
    kg: float
    m3: float
    kg_pct: float
    m3_pct: float
    cost_inr: float
    line_ids: list[str]               # FEFO pick order


class SolveInfo(Contract):
    status: Literal["optimal", "time_limit", "lp_round", "fallback_baseline_b", "not_solved"]
    seconds: float
    mip_gap: float | None = None
    solver: str = "highs"


class ExpectedKpis(Contract):
    freight_inr: float = 0.0
    lost_margin_inr: float = 0.0
    holding_inr: float = 0.0
    expiry_inr: float = 0.0
    carbon_kg: float = 0.0
    total_inr: float = 0.0
    cases: float = 0.0


class Plan(Contract):
    plan_id: str
    version: int
    scenario_id: str
    as_of: date
    temp_class: TempClass
    policy: PolicyName = "engine"
    settings: EngineSettings = EngineSettings()
    status: PlanStatus = PlanStatus.DRAFT
    lines: list[PlanLine]
    shortfalls: list[Shortfall] = []
    trucks: list[Truck]
    expected_kpis: ExpectedKpis = ExpectedKpis()
    solve: SolveInfo
    created_at: datetime


class Violation(Contract):
    constraint: Literal["lot_stock", "truck_kg", "truck_m3", "storage", "credit", "mrsl", "lock", "missing_truck", "missing_reason"]
    entity: str
    detail: str
    excess: float


class ValidationReport(Contract):
    ok: bool
    violations: list[Violation] = []


class OptimizeInput(Contract):
    scenario: Scenario
    snapshot: Snapshot
    forecast: ForecastBundle
    targets: list[Target]
    temp_class: TempClass
    settings: EngineSettings = EngineSettings()
    locks: list[Lock] = []
    plan_id: str
    version: int = 1


class SolveOutput(Contract):
    plan: Plan                         # lines + trucks, reasons not yet filled
    diagnostics: dict[str, Any] = {}   # slacks etc.; private between optimize.py and explain.py


# --------------------------------------------------------------------------- confirmation loop (Members C + D)

class Proposal(Contract):
    plan_id: str
    dist_id: str
    proposal_version: int
    status: ProposalStatus
    sent_at: datetime | None = None
    responded_at: datetime | None = None


class Message(Contract):
    dist_id: str
    proposal_version: int
    text: str
    line_ids: list[str]
    total_value_inr: float
    credit_available_inr: float


class LineAction(Contract):
    line_id: str
    action: ResponseAction
    qty: int | None = None             # required for trim; must be <= proposed


class LineDiff(Contract):
    line_id: str
    dist_id: str
    old_cases: int
    new_cases: int


class PlanEvent(Contract):
    plan_id: str
    plan_version: int
    dist_id: str | None
    actor: str
    action: Literal["accept", "trim", "reject", "override", "grow", "publish", "replan"]
    line_id: str | None = None
    old_qty: float | None = None
    new_qty: float | None = None
    delta_cost_inr: float = 0.0
    ts: datetime


# --------------------------------------------------------------------------- API request / response bodies (Member D)

class ForecastRequest(Contract):
    scenario_id: str
    as_of: date
    horizon_weeks: int = 4


class ForecastResponse(Contract):
    rows: list[ForecastRow]
    metrics: BacktestMetrics | None = None


class PlanRequest(Contract):
    scenario_id: str
    as_of: date
    temp_class: TempClass
    weights: Weights = Weights()
    locks: list[Lock] = []
    base_plan_id: str | None = None    # set to create a new version of an existing plan


class PublishRequest(Contract):
    version: int


class PublishResponse(Contract):
    plan_id: str
    version: int
    messages: list[Message]


class ResponseRequest(Contract):
    dist_id: str
    proposal_version: int
    actions: list[LineAction]


class ResponseResult(Contract):
    plan_version: int
    proposal_version: int
    grown_proposals: list[str]         # dist_ids whose proposal grew
    line_diff: list[LineDiff]
    delta_cost_inr: float


class DispatchTruck(Contract):
    truck: Truck
    lines: list[PlanLine]              # FEFO pick order


class DispatchResponse(Contract):
    plan_id: str
    version: int
    depot_id: str | None
    trucks: list[DispatchTruck]


class ExperimentRequest(Contract):
    policies: list[PolicyName] = ["engine", "baseline_a", "baseline_b"]
    seeds: int = 20
    opening_states: list[OpeningState] = ["neutral", "imbalanced"]


class ExperimentAccepted(Contract):
    experiment_id: str
    cached: bool


class ExperimentInfo(Contract):
    experiment_id: str
    status: ExperimentStatus
    progress_pct: float
    config_hash: str
    error: str | None = None


class KpiSummary(Contract):
    policy: PolicyName
    opening_state: OpeningState
    kpi: str                           # names in Architecture.md "KPI names"
    mean: float
    ci_low: float
    ci_high: float
    n_seeds: int
    delta_vs_best_baseline: float | None = None
    delta_ci_low: float | None = None
    delta_ci_high: float | None = None


class FrontierPoint(Contract):
    policy: PolicyName
    opening_state: OpeningState
    param: str                         # "pi_mult" | "service_level" | "cover_days"
    value: float
    fill_rate: float
    cost_to_serve_inr: float


class AblationRow(Contract):
    variant: PolicyName
    opening_state: OpeningState
    delta_cost_to_serve_inr: float
    ci_low: float
    ci_high: float
    delta_fill_rate_pp: float
    delta_wastage_inr: float


class ExperimentResults(Contract):
    experiment_id: str
    kpis: list[KpiSummary]
    frontier: list[FrontierPoint] = []
    ablation: list[AblationRow] = []


class AssumptionRow(Contract):
    parameter: str
    value: Any
    unit: str | None = None
    source: str | None = None          # citation, or "judgment"
    rationale: str | None = None
