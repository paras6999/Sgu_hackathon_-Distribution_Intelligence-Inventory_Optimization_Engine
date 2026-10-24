# Phases.md — Build plan (24 hours, team of 4)

Owners and contracts: `Team.md`. Each phase ends with an integration check; do not start the next phase with a red check.

## Phase 0 — Setup and contract freeze (hour 0, 30 min, everyone)
- Clone, create venv, `pip install -r requirements.txt`, `python -m pytest -q -rs` shows green with skips.
- Read `PRD.md` sections for your files, `Architecture.md` §4–6, `Rules.md`.
- Fill in names in `Team.md`; create your branch.
- D starts `make api-fake` and `make app` to confirm the shell UI works on fake data.

**Check:** tests green on all 4 laptops; nobody changes `engine/models.py` after this without a contract PR.

## Phase 1 — Build alone against fakes (hours 0–6)

| A · Data & Simulation | B · Forecast & Targets | C · Optimiser | D · API, DB & UI |
|---|---|---|---|
| `config.py` validation errors name the field | `dist.py`: NB/Poisson quantile, E[(D−z)+], E[(q−D)+] | `freight.py`: FTL, PTL, festival premium | Keep `store.py`, API and contract tests green |
| `weather.py`: fetch + cache Open-Meteo for 16 cities | AutoETS / TSB / seasonal naive on a toy series | `validate.py` against `fake_plan()` (must pass) and a broken copy (must fail) | Plan tab: table, KPI cards, weights slider |
| `generate.py`: nodes, SKUs, lanes, lots, 2-year demand, events → parquet | ADI/CV² classification; backtest harness | `optimize.py` skeleton on `fake_optimize_input()`: lots, trips, PTL, lost-sales curve | Dispatch tab + CSV; Inbox tab (accept / trim / reject) |
| `load_scenario`, `list_scenarios` | | | Assumptions tab from `/v1/assumptions` |

**Check (hour 6):** A's `seed01` exists; B's forecast runs on it; C's `solve()` returns a plan the validator accepts; D's UI runs all tabs on the fake backend.

## Phase 2 — Core engine joined (hours 6–12)

| A | B | C | D |
|---|---|---|---|
| `simulate.py` daily loop, FEFO/FIFO, expiry, credit cuts, conservation assert | Festival, promo, weather factors; weekly → daily windows | Waste curves C8, MRSL cliff, credit, storage; `build_loads` | Switch the API to the real backend endpoint by endpoint |
| `baseline_b.py` | `targets.py`; `baseline_a.py` | `explain.py` reason codes; `pipeline.make_plan` end to end | Results tab: KPI cards with CIs |
| `kpi.py` compute + summarise | Backtest report rows | Unit test per reason code on a 2×2 instance | Map tab (pydeck) on plan lines |

**Gate (hour 12, PRD §5.1):** one seed × 84 days, Engine + both baselines: 0 validator violations, 0 conservation failures, every line coded. 3-seed smoke run gives run time and baseline KPI levels; targets frozen and logged. If missed, apply the drop order in `PRD.md` §5.1.

## Phase 3 — Demo tier (hours 12–18)

| A | B | C | D |
|---|---|---|---|
| 20 seeds × 2 opening states; launch the full experiment (≈ 21 min); cache | Ablation (c) seasonal-naive path; backtest report screen data | `locks_for_response` + `apply_response` (FR-08); counterfactual reason-code test; speed tuning | Inbox calls the real re-solve; change-log view; frontier + ablation charts (FR-11, FR-12) |
| Fill every `assumptions` entry in `config.yaml` | Help A verify KPI numbers | | Map arc click filters plan table (FR-14) |

**Freeze (hour 18):** every demo screen loads from cache in real mode.
Drop order if behind: map → frontier points → ablations (c)(d)(f) → inbox UI → 10 seeds.

## Phase 4 — P1 extras (hours 18–22)
A: bug fixes and result caching. B: FR-23 heat-season window. C: FR-13 carbon slider, then FR-17 milk runs. D: deck and a recorded backup demo.

## Phase 5 — Rehearsal (hours 22–24)
Two full run-throughs of the 7-minute demo script (`PRD.md` §6.9) on one laptop with the network off.

## Post-hackathon (P2)
Excel ingestion, stochastic program, learned penalty weights, WhatsApp integration (`PRD.md` §5.3).
