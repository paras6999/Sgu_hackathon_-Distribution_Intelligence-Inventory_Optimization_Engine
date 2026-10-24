# Backlog.md — what to do next, in order

Items are written to be turned into Kiro specs (`docs/Kiro.md`). **OPUS** = Opus 5.5 must write `design.md` first and a human reviews it; Haiku implements only after that. **HAIKU** = small and concrete enough to implement directly from `tasks.md`. Size: S under 1 hour, M about half a day, L more. "Compute" = needs an experiment run (about 1 hour on 12 cores).

Facts and file locations are in `docs/Handoff.md`. Keep `bun run test` green after every item.

| ID | Item | Who | Size | Compute |
|---|---|---|---|---|
| B01 | CI green on `main` | HAIKU | S | – |
| B02 | Offline rehearsal and fixes | HAIKU | S | – |
| B03 | Rotate the AI key; live smoke script | HAIKU | S | – |
| B04 | Show freight per kg; explain the reefer price | HAIKU | S | – |
| B05 | Lost-sales window accounts for lead time | **OPUS** | M | yes |
| B06 | Tune the stockout weight on held-out seeds | **OPUS** | M | yes |
| B07 | Ablations on 10 seeds, add (c) and (f) | HAIKU | M | yes |
| B08 | Why per-SKU service levels did not pay | **OPUS** | M | yes |
| B09 | Forecaster: recover seasonality and weather | **OPUS** | L | yes |
| B10 | Ambient solve to 2 s or less | **OPUS** | L | – |
| B11 | Browser smoke test of every screen | HAIKU | M | – |
| B12 | Unit tests for the pure web helpers | HAIKU | S | – |
| B13 | Experiment id independent of assumption text | HAIKU | S | – |
| B14 | Remove or refresh stale files and docs | HAIKU | S | – |
| B15–B19 | Future scope (design only) | **OPUS** | – | – |

---

## B01 CI green on `main`
**Why.** `.github/workflows/ci.yml` (types, engine, backend, web, e2e) was never looked at during the build.
**Steps.** Open the Actions tab. For each failing job, reproduce locally with the same command from the workflow (`bun run check:types`, `bun test apps/dia-backend`, `uv run --package dia-engine pytest engine/dia-engine -q -rs`, `bunx tsc --noEmit -p apps/dia-web`). Likely suspects: `bun install --frozen-lockfile` after the `maplibre-gl` addition (commit `bun.lock`), the e2e job (`E2E=1`, generates a scenario and starts the engine; long), line-ending differences in `check:types`.
**Done when.** Latest `main` commit shows five green jobs. Stop rule: do not weaken a test to pass.

## B02 Offline rehearsal and fixes
**Why.** The demo must run with the network off; the map background and the web fonts need a network.
**Steps.** Disconnect, run `bun run dev` from a clean start, walk every screen (script in `docs/Demo.md`). Expected: map lanes draw on a plain background (works), Google Fonts link in `apps/dia-web/index.html` fails silently and falls back to Segoe UI. Fix anything that blocks a screen (spinners that never end, errors). Document what degrades.
**Done when.** A written checklist in `docs/Demo.md` "Offline run" with each screen marked.

## B03 Rotate the AI key; live smoke script
**Why.** A key was exposed in a chat. The live path was only run once by hand.
**Steps.** Owner rotates the key in Google Cloud (not a coding task). Add `scripts/ai-smoke.ts` (reads root `.env`, calls `/v1/ai/status` and one `POST /v1/ai/analyse` for a results analysis, prints status, `verified` and the first 200 characters). Add the command to `docs/Handoff.md` §2.
**Done when.** `bun scripts/ai-smoke.ts` prints `source: ai`, `verified: true` with a valid key, and a clear message without one. No key is printed or committed.

## B04 Show freight per kg; explain the reefer price
**Why.** A reviewer thought chilled freight "looked the same as ambient". The reefer trip is cheaper than the dry truck because it is a smaller vehicle; per kg it is about 1.9× (₹8.8 vs ₹4.6).
**Steps.** In `apps/dia-web/src/pages/PlanPage.tsx` add a KPI tile "Freight per kg" (freight ÷ kg of all lines; kg per case is in the scenario `skus`, fetch via `api.scenario`). In `DispatchPage.tsx` show cost per kg on each truck header. Change the `costs.ftl.REEF17` assumption rationale in `config.yaml` to state the premium over a dry vehicle of the same size. **Changing config text changes the experiment id (B13 first)**.
**Done when.** Chilled and ambient plans show different freight per kg on screen; typecheck and build pass.

## B05 Lost-sales window accounts for lead time — OPUS
**Why.** The model credits shipped stock against demand from day 0, but it arrives after the lead time; this is the likely cause of the fill-rate gap (−0.4 / −0.8 points; the PRD target was +2 / +4).
**Design questions for Opus.** Where in `optimize/optimize.py` (constraint C2) and `forecast/targets.py` the window is built; whether demand during the lead time should be served only from on-hand stock; effect on the curve breakpoints; a regression test on a tiny synthetic case; the experiment to run and what result would count as success.
**Done when (after design review).** A 3-seed smoke comparison shows fill rate up and cost to serve not worse by more than 2%; then the full experiment is re-run and `docs/Demo.md` numbers are updated.

## B06 Tune the stockout weight on held-out seeds — OPUS
**Why.** `costs.stockout_penalty_x_margin` = 2.4 was chosen from the frontier of seeds 1–5, which are also evaluation seeds.
**Design.** Generate seeds 11–15, sweep the weight on those only, choose, then report on seeds 1–10 untouched. Needs `run_experiment` to accept a seed range (today `range(1, seeds + 1)` in `sim/simulate.py`). The PRD default 1.2 is the other candidate.
**Done when.** The assumption rationale says "tuned on seeds 11–15"; results re-run; numbers updated.

## B07 Ablations on 10 seeds, add (c) and (f) — HAIKU after one config change
**Steps.** In `sim/simulate.py` set `SUBSET_SEEDS = 10`; extend the web request `MAIN_EXPERIMENT` in `apps/dia-web/src/api.ts` to add `abl_no_credit` and `abl_home_depot`; run the experiment; update `docs/Demo.md`. Expect (f) near zero (no alternative depot within 600 km) and say so.
**Done when.** Results page shows 5 ablation rows per opening state.

## B08 Why per-SKU service levels did not pay — OPUS
**Why.** `abl_uniform_service` (one service level for every SKU) was cheaper than the engine by ₹2–6 lakh.
**Design.** Inspect `forecast/targets.py` `critical_ratio` (expiry term uses `cover / RSL`), compare chosen service levels per SKU with realised fill, decide whether the per-SKU differentiation is mis-specified or just worth little. Output: a short analysis in `docs/` and, if justified, a change plus a re-run.

## B09 Forecaster: recover seasonality and weather — OPUS (L)
**Why.** Learned monthly seasonality is nearly flat (beverage May peak 1.04 vs 1.40 configured) and the heat effect is 0.5 vs 4 %/°C. The seasonal fit in `forecast/forecast.py` `_factors` divides by a centred rolling median that removes slow seasonality.
**Design.** Alternatives: fit seasonality on year-over-year ratios, fit weather on deseasonalised residuals jointly, or shrink toward a prior. Success: learned vs configured seasonal correlation above 0.8 for beverages and dairy **and** WAPE not worse. Tests in `test_demand_analysis.py` already print the comparison.

## B10 Ambient solve to 2 s or less — OPUS (L)
**Why.** About 2–4 s today (PRD target ≤ 2 s); an engine simulation run takes about 2 minutes.
**Ideas.** Model build is about 1 s (cache window distributions, avoid recomputing `expected_leftover`), HiGHS needs a better incumbent (warm start from the baseline plan, tighter trip bounds), fewer arcs (prune lots with negligible value). Keep `time_limit` status and validator unchanged.

## B11 Browser smoke test of every screen — HAIKU
**Steps.** Add Playwright (ask the owner before adding the dependency) with one test that starts `dev:fake`, opens each of the 8 tabs and asserts a heading and no console errors. Run in CI as an extra job.
**Done when.** `bun run test:e2e-web` passes locally and in CI.

## B12 Unit tests for the pure web helpers — HAIKU
Worked example in `docs/Kiro.md` §5.

## B13 Experiment id independent of assumption text — HAIKU
**Why.** The id hashes the whole assumptions table including `source` and `rationale` text, so editing a sentence orphans the cached results.
**Steps.** In `apps/dia-backend/src/app.ts` (`POST /v1/experiments`) hash only `parameter` and `value` of each assumption plus the request. Add a test: changing a rationale keeps the id; changing a value changes it. Note in `docs/Memory.md` that existing cached runs get a new id once (copy the folder `data/engine/experiments/<old>` to the new id and insert the SQLite row, or just re-run).
**Done when.** The test passes.

## B14 Remove or refresh stale files and docs — HAIKU
`apps/dia-fallback-ui/` (unmaintained Streamlit app), the root `app/__pycache__/`, solo-build wording in `docs/Team.md` and `docs/Phases.md`, route tables in `docs/PRD.md` §6 that differ from `docs/Architecture.md` §6. Ask the owner before deleting a folder.

---

## B15–B19 Future scope (Opus writes design only; nothing to implement yet)
- **B15 Release binaries** (`dia-engine` via PyInstaller, `dia-server` via `bun build --compile`): optional.
- **B16 Pilot ingestion (PRD FR-26):** messy distributor Excel and daily CSV/SFTP exports in; fuzzy SKU matching; data-staleness flag. Needs real files to build against.
- **B17 Multi-drop routes (FR-17)** for chilled goods (attacks the low reefer fill).
- **B18 Lateral rebalancing (FR-18)** between distributors and between depots.
- **B19 What-if panel and planner overrides (FR-19, FR-22):** demand shock, depot outage, diesel +10%; override a line and show the rupee cost.
Other PRD items: multi-period stochastic model (FR-28), WhatsApp Business messaging (FR-29), scale benchmark (FR-24), second evaluation window in the heat season (FR-23), carbon price in the UI (FR-13; the optimiser already accepts it).
