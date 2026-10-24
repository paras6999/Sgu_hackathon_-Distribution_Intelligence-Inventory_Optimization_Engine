# Phases.md — Solo build plan

One person with Claude Code. Order follows dependencies; each step ends with a check, and the next step starts only when it is green. Hours are rough estimates for planning the 24-hour clock.

## Done
- Monorepo, shared types and codegen, fixtures, CI, backend (17 endpoints, SQLite, fake/source/binary engine modes), web shell (Plan, Inbox, Dispatch on fake data).
- Generator v0 (realistic, seeded), weather fallback.
- `forecast/dist.py`, `forecast/forecast.py` (WAPE 14.6% on seed01), `forecast/targets.py`.
- Baselines A and B with shared lot, limit, truck and freight helpers.

## Phase 1 — Plan one cycle on real data (≈ 9 h)

| # | Task | Done when |
|---|---|---|
| 1 | `optimize/freight.py`: move the A11–A13 formulas and load build out of `baselines/common.py`; both baselines call it | Baseline tests still pass; one freight implementation |
| 2 | `optimize/validate.py`: independent checks (lot stock, truck kg/m³, storage, credit, MRSL, locks, truck ids, reasons) | `test_validator_accepts_fixture_plan` and `…catches_overshipment` pass |
| 3 | `sim/simulate.get_snapshot`: neutral and imbalanced opening states from `lots` | `GET /v1/scenarios/seed01/snapshot` returns a real snapshot |
| 4 | `optimize/optimize.py`: MILP with lots, arcs (MRSL, 3 candidate depots), integer FTL trips, PTL with minimum charge, lost-sales curve C2, waste curve C8, MRSL cliff, storage, credit (PuLP + HiGHS, CBC fallback) | `test_optimizer_output_is_valid` passes; ambient solve ≤ 2 s on seed01 |
| 5 | `optimize/explain.py`: the 11 reason codes with ₹ figures | Every line has a code; one unit test per code |
| 6 | `optimize/pipeline.make_plan` end to end; web Plan tab in `ENGINE_MODE=source` | `POST /v1/plans` returns a validated plan with reasons on seed01 |

## Phase 2 — Prove it (≈ 7 h)

| # | Task | Done when |
|---|---|---|
| 7 | `sim/simulate.run_policy`: daily loop, deliveries with delays, FEFO/FIFO sales, expiry, credit cuts, plant receipts, conservation assert | One seed × 84 days runs for engine and both baselines |
| 8 | `sim/kpi.py`: KPIs of PRD §8.2 and `summarise` (means, 90% paired CIs, deltas vs better baseline) | `results.json` written |
| 9 | `run_experiment`: seeds × opening states in parallel, frontier and ablation runs | **Gate:** 0 validator violations, 0 conservation failures, every line coded; smoke run timing known; targets frozen |

## Phase 3 — Demo tier (≈ 5 h)

| # | Task | Done when |
|---|---|---|
| 10 | `pipeline.locks_for_response` + `apply_response` (FR-08) | Inbox trim does a real re-solve; unanswered proposals never shrink |
| 11 | Results, Frontier & Ablation, Assumptions pages | Every demo screen loads from the cached experiment |
| 12 | Full experiment (20 seeds × 2 states, or 10 if short on time) cached | Results page shows real numbers |

## Phase 4 — Ship and rehearse (≈ 3 h)
- Demo deck and screenshots; two rehearsals of the 7-minute script (`PRD.md` §6.9) with the network off.
- Optional: release binaries (`dia-engine` via PyInstaller, `dia-server` via `bun build --compile`). Demoing from source is fine.

## Drop order (cut from the top when behind)
1. Release binaries → demo from source.
2. AI narration (stays off).
3. Map page → static lane table.
4. Ablations (c)(d)(f) → keep (a) expiry, (b) truck steps, (e) service levels.
5. Frontier → 3 points per policy.
6. Seeds → 10 instead of 20 (report the wider intervals).
7. Inbox re-solve → trim applied directly, shown through the API.

Never cut: the validator, the conservation check, both baselines, reason codes, both opening states.

## Open issues to handle on the way
- Chilled freight is ~25–30% of chilled value with small reefer loads; decide in step 4 (more dairy volume, smaller vehicles, or multi-drop runs FR-17).
- Baseline A weights use forecast demand because snapshots carry no trailing sales; add them in step 3 if wanted.
