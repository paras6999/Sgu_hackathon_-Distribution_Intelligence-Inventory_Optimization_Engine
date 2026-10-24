# Phases.md — Build plan (24 hours)

## Phase 1 — Foundations (hours 0–6)
- config.yaml + pydantic schema
- FR-01 scenario generator (4 depots, 16 distributors, 24 SKUs, 2 years history)
- FR-02 weather cache (Open-Meteo)
- Forecast base models + backtest harness
- Optimiser skeleton (lots, trips, PTL, lost-sales curves) + validator
- API skeleton + Streamlit shell

**Done when:** `make data` is reproducible; validator passes on a hand-built instance.

## Phase 2 — Core engine (hours 6–12)
- Simulation loop, conservation tests, credit cuts
- Baselines A and B
- Festival/promo/weather factors, window distributions, targets
- Waste curves, MRSL cliff, credit, storage, load build, reason codes
- Plan table, dispatch view, KPI cards

**Gate (hour 12):** one seed x 84 days, engine + both baselines: 0 violations, 0 conservation failures, every line coded. A 3-seed smoke run sets KPI levels and the run-time estimate.

## Phase 3 — Demo tier (hours 12–18)
- Two opening states, 20 seeds, full cached experiment
- Ablations (FR-12), frontier (FR-11), map (FR-14), assumptions tab (FR-15)
- Distributor inbox and locked re-solve (FR-08)
- Counterfactual reason-code tests

**Freeze (hour 18):** every demo screen loads from cache.
Drop order if behind: map -> frontier points -> ablations c/d/f -> inbox UI -> 10 seeds.

## Phase 4 — P1 extras (hours 18–22)
FR-13 carbon, FR-23 heat-season window, FR-17 milk runs. Deck and backup demo recording.

## Phase 5 — Rehearsal (hours 22–24)
Two full run-throughs of the 7-minute demo script (PRD §6.9).

## Post-hackathon (P2)
Excel ingestion, stochastic program, learning penalties from logs, WhatsApp integration (PRD §5.3).
