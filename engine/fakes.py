"""Small, valid, hand-built objects for every contract (owner: shared; keep them valid).

Use them to build your part before the upstream part exists:
  * Member B tests targets on fake_scenario() + fake_forecast().
  * Member C tests the optimiser on fake_optimize_input(); fake_plan() must pass the validator.
  * Member A tests the simulator with fake policies that return fake_plan().
  * Member D runs the whole API on these (VITARAN_FAKE=1) before any engine code exists.

World: 2 depots, 3 distributors, 3 SKUs, as_of Monday 13 Oct 2025 (Diwali 20 Oct 2025).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from engine.models import (
    AblationRow, BacktestMetrics, DistStock, EngineSettings, ExpectedKpis, ExperimentResults, ForecastBundle,
    ForecastRow, FrontierPoint, KpiSummary, Lane, Lot, Node, NodeType, OptimizeInput, PairForecast, Plan,
    PlanLine, Reason, ReasonCode, Scenario, ShipMode, Shortfall, Sku, Snapshot, SolveInfo, Target, TempClass,
    Truck, TruckClass,
)

SCENARIO_ID = "seed01"
AS_OF = date(2025, 10, 13)
HORIZON_DAYS = 28
FESTIVAL_DAYS = {date(2025, 10, 18), date(2025, 10, 19), date(2025, 10, 20)}


def _ftl_cost(km: float, cls: TruckClass) -> float:
    if cls is TruckClass.AMB32:
        return max(15000.0, 8000 + 40.0 * km)
    return max(10000.0, 6000 + 42.5 * km)


def _ptl_rate(km: float) -> float:
    return 4.5 if km <= 300 else 8.0 if km <= 800 else 15.0


def fake_scenario() -> Scenario:
    nodes = [
        Node(node_id="W1-Bhiwandi", type=NodeType.DEPOT, city="Bhiwandi", region="W", lat=19.30, lon=73.06),
        Node(node_id="S1-Hosur", type=NodeType.DEPOT, city="Hosur", region="S", lat=12.74, lon=77.83),
        Node(node_id="D01-Pune", type=NodeType.DISTRIBUTOR, city="Pune", region="W", lat=18.52, lon=73.86,
             storage_m3=120, credit_limit_inr=1_500_000, mrsl_fraction=0.6, home_depot_id="W1-Bhiwandi"),
        Node(node_id="D09-Bengaluru", type=NodeType.DISTRIBUTOR, city="Bengaluru", region="S", lat=12.97,
             lon=77.59, storage_m3=150, credit_limit_inr=1_000_000, mrsl_fraction=0.6, home_depot_id="S1-Hosur"),
        Node(node_id="D10-Coimbatore", type=NodeType.DISTRIBUTOR, city="Coimbatore", region="S", lat=11.02,
             lon=76.96, storage_m3=100, credit_limit_inr=600_000, mrsl_fraction=0.6, home_depot_id="S1-Hosur"),
    ]
    skus = [
        Sku(sku_id="DY-03", name="Paneer 200 g", category="dairy", temp_class=TempClass.CHILLED,
            shelf_life_days=15, kg_per_case=4.8, m3_per_case=0.012, price_inr=1800, landed_cost_inr=1300,
            margin_inr=500, disposal_inr=50),
        Sku(sku_id="SN-01", name="Masala Chips 50 g", category="snacks", temp_class=TempClass.AMBIENT,
            shelf_life_days=120, kg_per_case=3.0, m3_per_case=0.045, price_inr=1200, landed_cost_inr=850,
            margin_inr=350, disposal_inr=20),
        Sku(sku_id="HC-02", name="Detergent 1 kg", category="home_care", temp_class=TempClass.AMBIENT,
            shelf_life_days=730, kg_per_case=12.5, m3_per_case=0.03, price_inr=2100, landed_cost_inr=1600,
            margin_inr=500, disposal_inr=30),
    ]
    km = {("W1-Bhiwandi", "D01-Pune"): 160, ("W1-Bhiwandi", "D09-Bengaluru"): 1000,
          ("W1-Bhiwandi", "D10-Coimbatore"): 1300, ("S1-Hosur", "D01-Pune"): 1000,
          ("S1-Hosur", "D09-Bengaluru"): 40, ("S1-Hosur", "D10-Coimbatore"): 260}
    lanes = [
        Lane(from_id=f, to_id=t, km=d, lead_days_mean=1 if d <= 300 else 3 if d <= 1000 else 4,
             p_delay=0.1 if d <= 300 else 0.2,
             ftl_cost_inr={c: _ftl_cost(d, c) for c in TruckClass},
             ptl_rate_inr_per_kg=_ptl_rate(d), ptl_min_charge_inr=1500,
             co2_kg_per_trip={TruckClass.AMB32: d / 3.5 * 2.68, TruckClass.REEF17: d / 4.0 * 2.68})
        for (f, t), d in km.items()
    ]
    return Scenario(scenario_id=SCENARIO_ID, seed=1, nodes=nodes, skus=skus, lanes=lanes)


def fake_snapshot() -> Snapshot:
    lots = [
        Lot(lot_id="HSR-DY03-1187", sku_id="DY-03", depot_id="S1-Hosur", qty_cases=200,
            mfg_date=date(2025, 10, 13), expiry_date=date(2025, 10, 28)),
        Lot(lot_id="BHW-SN01-0420", sku_id="SN-01", depot_id="W1-Bhiwandi", qty_cases=600,
            mfg_date=date(2025, 9, 1), expiry_date=date(2025, 12, 30)),
        Lot(lot_id="HSR-SN01-0388", sku_id="SN-01", depot_id="S1-Hosur", qty_cases=300,
            mfg_date=date(2025, 8, 30), expiry_date=date(2025, 12, 28)),
        Lot(lot_id="BHW-HC02-0101", sku_id="HC-02", depot_id="W1-Bhiwandi", qty_cases=800,
            mfg_date=date(2025, 7, 1), expiry_date=date(2027, 7, 1)),
    ]
    stock = [
        DistStock(dist_id="D01-Pune", sku_id="SN-01", lot_id="BHW-SN01-0377", qty_cases=40,
                  expiry_date=date(2025, 12, 1)),
        DistStock(dist_id="D09-Bengaluru", sku_id="DY-03", lot_id="HSR-DY03-1170", qty_cases=12,
                  expiry_date=date(2025, 10, 20)),
    ]
    return Snapshot(scenario_id=SCENARIO_ID, as_of=AS_OF, depot_lots=lots, dist_stock=stock, in_transit=[],
                    credit_available_inr={"D01-Pune": 1_200_000, "D09-Bengaluru": 900_000, "D10-Coimbatore": 500_000},
                    storage_free_m3={"D01-Pune": 80, "D09-Bengaluru": 100, "D10-Coimbatore": 60})


_DAILY_MEAN = {
    ("SN-01", "D01-Pune"): 25, ("SN-01", "D09-Bengaluru"): 20, ("SN-01", "D10-Coimbatore"): 12,
    ("HC-02", "D01-Pune"): 15, ("HC-02", "D09-Bengaluru"): 10, ("HC-02", "D10-Coimbatore"): 8,
    ("DY-03", "D01-Pune"): 6, ("DY-03", "D09-Bengaluru"): 8, ("DY-03", "D10-Coimbatore"): 5,
}


def fake_forecast() -> ForecastBundle:
    pairs, weekly = [], []
    days = [AS_OF + timedelta(days=i) for i in range(HORIZON_DAYS)]
    for (sku, dist), base in _DAILY_MEAN.items():
        fest = [1.38 if d in FESTIVAL_DAYS else 1.0 for d in days]
        mean = [base * f for f in fest]
        var = [1.5 * m for m in mean]
        pairs.append(PairForecast(sku_id=sku, dist_id=dist, start=AS_OF, mean=mean, var=var, festival=fest,
                                  weather=[1.0] * HORIZON_DAYS, promo=[1.0] * HORIZON_DAYS, model="AutoETS"))
        for w in range(HORIZON_DAYS // 7):
            mu = sum(mean[w * 7:(w + 1) * 7])
            sd = sum(var[w * 7:(w + 1) * 7]) ** 0.5
            weekly.append(ForecastRow(sku_id=sku, dist_id=dist, week_start=days[w * 7], p10=max(0.0, mu - 1.2816 * sd),
                                      p50=mu, p90=mu + 1.2816 * sd, model="AutoETS",
                                      factors={"Diwali": 1.38} if w == 0 else {}))
    return ForecastBundle(scenario_id=SCENARIO_ID, as_of=AS_OF, horizon_days=HORIZON_DAYS, pairs=pairs, weekly=weekly)


def fake_backtest() -> BacktestMetrics:
    return BacktestMetrics(wape=0.31, wape_seasonal_naive=0.37, bias=-0.02, coverage_p10_p90=0.79,
                           wape_festival_weeks=0.41)


def fake_targets() -> list[Target]:
    out = []
    for (sku, dist), base in _DAILY_MEAN.items():
        cover = 4 if sku == "DY-03" else 10
        mu, sigma = base * cover, (1.5 * base * cover) ** 0.5
        cr, z = (0.62, 0.31) if sku == "DY-03" else (0.90, 1.28)
        out.append(Target(sku_id=sku, dist_id=dist, S=mu + z * sigma, critical_ratio=cr, z=z,
                          cover_days=cover, mu=mu, sigma=sigma))
    return out


def fake_optimize_input(temp_class: TempClass = TempClass.AMBIENT) -> OptimizeInput:
    return OptimizeInput(scenario=fake_scenario(), snapshot=fake_snapshot(), forecast=fake_forecast(),
                         targets=fake_targets(), temp_class=temp_class, settings=EngineSettings(),
                         plan_id="PL-FAKE01", version=1)


def fake_plan(plan_id: str = "PL-FAKE01", version: int = 1) -> Plan:
    """Ambient plan that satisfies every validator constraint on fake_snapshot()."""
    sc = fake_scenario()
    sku = {s.sku_id: s for s in sc.skus}
    lane = {(l.from_id, l.to_id): l for l in sc.lanes}
    ship, eta = AS_OF, AS_OF + timedelta(days=1)
    raw = [  # sku, lot, expiry, from, to, cases, mode, truck/consignment, reasons
        ("SN-01", "BHW-SN01-0420", date(2025, 12, 30), "W1-Bhiwandi", "D01-Pune", 120, ShipMode.FTL, "T-W1-D01-01",
         [Reason(code=ReasonCode.FESTIVAL_UPLIFT, detail="Diwali x1.38 in the cover window (18-20 Oct).")]),
        ("HC-02", "BHW-HC02-0101", date(2027, 7, 1), "W1-Bhiwandi", "D01-Pune", 400, ShipMode.FTL, "T-W1-D01-01",
         [Reason(code=ReasonCode.CHEAPEST_SOURCE, detail="From Bhiwandi at Rs 40/case vs Rs 98/case from Hosur.",
                 impact_inr=23200)]),
        ("SN-01", "HSR-SN01-0388", date(2025, 12, 28), "S1-Hosur", "D09-Bengaluru", 150, ShipMode.PTL, "C-S1-D09-01",
         [Reason(code=ReasonCode.CHEAPEST_SOURCE, detail="From Hosur at Rs 51/case vs Rs 300/case from Bhiwandi.",
                 impact_inr=37350)]),
        ("SN-01", "HSR-SN01-0388", date(2025, 12, 28), "S1-Hosur", "D10-Coimbatore", 100, ShipMode.PTL, "C-S1-D10-01",
         [Reason(code=ReasonCode.STOCK_LIMITED, detail="Short 20 cases of target: all usable Hosur stock committed.")]),
    ]
    lines: list[PlanLine] = []
    for i, (s, lot, exp, f, t, cases, mode, tid, reasons) in enumerate(raw, start=1):
        lines.append(PlanLine(
            line_id=f"{plan_id}-v{version}-{i:03d}", sku_id=s, sku_name=sku[s].name, lot_id=lot, expiry=exp,
            from_id=f, to_id=t, cases=cases, mode=mode,
            truck_id=tid if mode is ShipMode.FTL else None, consignment_id=tid if mode is ShipMode.PTL else None,
            truck_class=TruckClass.AMB32 if mode is ShipMode.FTL else None, ship_date=ship, eta=eta,
            rsl_on_arrival_days=(exp - eta).days, freight_alloc_inr=0.0, reasons=reasons))
    trucks: list[Truck] = []
    for tid in dict.fromkeys(l.truck_id or l.consignment_id for l in lines):
        tl = [l for l in lines if (l.truck_id or l.consignment_id) == tid]
        kg = sum(l.cases * sku[l.sku_id].kg_per_case for l in tl)
        m3 = sum(l.cases * sku[l.sku_id].m3_per_case for l in tl)
        ln = lane[(tl[0].from_id, tl[0].to_id)]
        if tl[0].mode is ShipMode.FTL:
            cost = ln.ftl_cost_inr[TruckClass.AMB32] * 1.2   # festival premium, Oct
            shares = [max(l.cases * sku[l.sku_id].kg_per_case / 7000, l.cases * sku[l.sku_id].m3_per_case / 55) for l in tl]
            kg_pct, m3_pct, cls = 100 * kg / 7000, 100 * m3 / 55, TruckClass.AMB32
        else:
            cost = max(ln.ptl_min_charge_inr, ln.ptl_rate_inr_per_kg * max(kg, 250 * m3))
            shares = [l.cases * max(sku[l.sku_id].kg_per_case, 250 * sku[l.sku_id].m3_per_case) for l in tl]
            kg_pct, m3_pct, cls = 0.0, 0.0, None
        for l, sh in zip(tl, shares):
            l.freight_alloc_inr = round(cost * sh / sum(shares), 2)
        trucks.append(Truck(truck_id=tid, mode=tl[0].mode, truck_class=cls, from_id=tl[0].from_id, to_id=tl[0].to_id,
                            ship_date=ship, kg=kg, m3=m3, kg_pct=kg_pct, m3_pct=m3_pct, cost_inr=round(cost, 2),
                            line_ids=[l.line_id for l in tl]))
    freight = sum(t.cost_inr for t in trucks)
    kpis = ExpectedKpis(freight_inr=freight, lost_margin_inr=8400, holding_inr=3100, expiry_inr=0,
                        total_inr=freight + 8400 + 3100, cases=sum(l.cases for l in lines))
    return Plan(plan_id=plan_id, version=version, scenario_id=SCENARIO_ID, as_of=AS_OF, temp_class=TempClass.AMBIENT,
                lines=lines, trucks=trucks, expected_kpis=kpis,
                shortfalls=[Shortfall(sku_id="SN-01", dist_id="D10-Coimbatore", short_cases=20,
                                      reasons=[Reason(code=ReasonCode.STOCK_LIMITED, detail="All usable stock committed.")])],
                solve=SolveInfo(status="optimal", seconds=0.4, mip_gap=0.0),
                created_at=datetime(2025, 10, 13, 9, 0, tzinfo=timezone.utc))


def fake_results(experiment_id: str = "EX-fake") -> ExperimentResults:
    base = {"fill_rate": (0.915, 0.94), "wastage_inr": (410_000, 300_000), "cost_to_serve_inr": (9_800_000, 8_900_000),
            "freight_inr_per_case": (41.0, 42.5), "ftl_utilisation": (0.76, 0.88), "stockout_rate": (0.06, 0.045)}
    kpis = []
    for state in ("neutral", "imbalanced"):
        for name, (bl, eng) in base.items():
            for policy, v in (("baseline_a", bl * 1.02), ("baseline_b", bl), ("engine", eng)):
                kpis.append(KpiSummary(policy=policy, opening_state=state, kpi=name, mean=v, ci_low=v * 0.98,
                                       ci_high=v * 1.02, n_seeds=20,
                                       delta_vs_best_baseline=(eng - bl) if policy == "engine" else None,
                                       delta_ci_low=(eng - bl) * 1.2 if policy == "engine" else None,
                                       delta_ci_high=(eng - bl) * 0.8 if policy == "engine" else None))
    frontier = [FrontierPoint(policy="engine", opening_state="neutral", param="pi_mult", value=m,
                              fill_rate=0.90 + 0.012 * i, cost_to_serve_inr=8_700_000 + 150_000 * i)
                for i, m in enumerate([0.25, 0.5, 1, 2, 4])]
    ablation = [AblationRow(variant=v, opening_state="neutral", delta_cost_to_serve_inr=d, ci_low=d * 1.3,
                            ci_high=d * 0.7, delta_fill_rate_pp=fr, delta_wastage_inr=w)
                for v, d, fr, w in [("abl_no_expiry", 310_000, -0.2, 150_000), ("abl_no_truck_steps", 280_000, 0.1, 0),
                                    ("abl_uniform_service", 190_000, -0.6, 60_000)]]
    return ExperimentResults(experiment_id=experiment_id, kpis=kpis, frontier=frontier, ablation=ablation)
