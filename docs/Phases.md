# Phases.md — Build plan (24 hours)

Owners and workflow: `Team.md`. Each phase ends with a check; don't start the next phase with a red check.

## Phase −1 — Foundation (done before the clock: PR `m2/rescaffold`)
Monorepo, shared types + codegen, fixtures, engine package with stubs + generator v0, Bun/Hono backend with all 17 endpoints, React web shell (Plan, Inbox, Dispatch working on fakes), CI, docs and per-member guides.

## Phase 0 — Setup (hour 0, 30 min, everyone)
- `bun run setup && bun run test` green on every laptop.
- Read `docs/team/<you>.md`, then `PRD.md` sections for your files.
- M2 turns on branch protection and fills in `CODEOWNERS`; M1 opens `m1/build-release`.

## Phase 1 — Build alone against fakes (hours 0–6)

| M1 · Kiro | M2 · Claude Code | M3 · Antigravity | M4 · data |
|---|---|---|---|
| **`m1/build-release`: `dia-engine` (PyInstaller) + `dia-server` (Bun, web embedded) build on Windows/Linux/macOS — proven by hour 3** | `forecast/dist.py`: NB/Poisson quantile, E[(D−z)+], E[(q−D)+] | Results page (KPI cards + CI) on fixtures | Fetch real weather (`dia-engine weather --fetch`) and compare with fallback |
| `freight.py`; `validate.py` passes on `fixtures/plan.json`, fails on a broken copy | AutoETS / TSB / seasonal naive + backtest harness | Assumptions page | Review SKU catalogue, prices, shelf lives; add sources |
| `optimize.py` skeleton on fixtures: lots, trips, PTL, lost-sales curve | Wire web to `ENGINE_MODE=source` | | Fix the chilled-freight realism issue (`Memory.md`) |

**Check (hour 6):** forecast runs on seed01; `solve()` gives a validator-clean plan; binaries start.

## Phase 2 — Core engine joined (hours 6–12)

| M1 | M2 | M3 | M4 |
|---|---|---|---|
| Waste curves, MRSL cliff, credit, storage, `build_loads`, `explain.py`, `make_plan` end to end | Festival/promo/weather factors, window distributions, `targets.py` | Frontier + ablation charts on fixtures | Sanity checks for new realism rules |
| `get_snapshot`, simulation loop, credit cuts, conservation assert, `kpi.py` | Baseline A and B (use `freight.py`) | | |

**Gate (hour 12, PRD §5.1):** one seed × 84 days, engine + both baselines: 0 violations, 0 conservation failures, every line coded. 3-seed smoke run; targets frozen. Missed → drop order.

## Phase 3 — Demo tier (hours 12–18)

| M1 | M2 | M3 | M4 |
|---|---|---|---|
| `locks_for_response` + `apply_response` (FR-08); counterfactual reason-code test; full experiment (20 seeds × 2 states) | Integrate M3's pages; results screens on real data; review fixes | Map page (MapLibre, no key) | Fix realism issues the experiment exposes |
| Release v0.1 binaries; optional AI narration behind its flag | Take over any M3 page not merged by hour 15 | | |

**Freeze (hour 18):** every screen loads from cache on the release binaries. Drop order: map → frontier points → ablations (c)(d)(f) → inbox UI → 10 seeds.

## Phase 4 — P1 extras (hours 18–22)
M1: FR-13 carbon slider, FR-17 milk runs, final release. M2: FR-23 heat-season window, bug fixes. M3: deck + screenshots. M4: data notes for the deck.

## Phase 5 — Rehearsal (hours 22–24)
Two full runs of the 7-minute demo (PRD §6.9) from the release zip, network off.
