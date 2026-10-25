# Ground-truth.md: what is actually true in the repo (Run 0)

Run on 25 Oct 2026, 05:27–06:10 IST, on the new owner's Windows machine (12 logical cores), at commit `b841759` (`main` = `origin/main`). Prompt: `docs/Kiro-first-prompt.md`. No code, config, schema or test was changed. Where this file disagrees with `docs/Handoff.md` or `docs/Backlog.md`, this file wins (Backlog.md says so).

Status words: **CONFIRMED** (reproduced here), **DIFFERS** (the repo or a measurement disagrees with the docs), **UNVERIFIED** (could not be checked in this run; the reason is given).

---

## 1. Summary

1. **Works:** setup, typecheck (3/3 packages), tests (types 8 pass; backend 29 pass, 6 skipped e2e; engine 144 pass, 0 skipped), web build, weather fetch, scenario generation, and the full stack. Every API call in the prompt returned a validated plan with a reason on every line.
2. **CI is green.** All five jobs passed on the latest `main` run (`b841759`, run 40144776395); e2e ran 4 tests against a real engine. Backlog B01 is already done.
3. **Confirmed claims:** 23 routes, all four config values, plant receipts before dispatch, write-off on every lot, the 1.5 s / 1.0 s caps, `time_limit` status, AI layer outputs text only, `FAIR_SHARE_FLOOR` never emitted, and real weather in use.
4. **Differs:** forecast WAPE is **21.8%** (naive 27.9%), not the documented 14.6% (naive 29.3%). The docs carry a number measured at commit `fce0fab`, before the generator changed three times.
5. **Differs:** `sim/simulate.py:295` validates every policy's plan directly, not only baseline plans, so engine plans are validated twice. This breaks `docs/Rules.md:13` as written, but it is a sensible exception.
6. **Unverified:** the result of record (`EX-de4798536119`) and "0 conservation failures in 483,840 rows". The results are not in git and the 1-hour re-run was out of scope. One seed reproduced the direction: cost −18.6%, wastage −80%, fill −0.47 pp against Baseline A.
7. **Risk 1, secret:** the tracked file `.env.example` now holds an uncommitted, key-like `GEMINI_API_KEY` value. It was written at 05:38 during this run by something outside the repo's code. One `git add -A` would publish it. HEAD and all history are clean.
8. **Risk 2, stale numbers in the pitch:** `docs/Demo.md:65` and `docs/Handoff.md:13` quote a forecast accuracy that the current code does not produce. The result of record also cannot be reproduced bit-for-bit, because every solve stops on a wall-clock limit.
9. **Risk 3, cache keyed without code:** the experiment id hashes config and request but not code (`apps/dia-backend/src/app.ts:272`). After a B05 or B10 code change, the Results page silently serves the old cached run.
10. **B10 facts:** an ambient solve (`solve.seconds` 2.24–2.90 s) is 0.70–1.20 s model build, then 1.55–1.59 s in HiGHS (always hits the 1.5 s cap), then 0.14–0.17 s rounding. `explain` adds another 1.07–1.87 s outside `solve.seconds`.

---

## 2. Environment and command log

Working directory: `c:\Dev-Drive\sgu-hack\Sgu_hackathon_-Distribution_Intelligence-Inventory_Optimization_Engine`. Output is trimmed to counts and errors.

### Step 1: environment

| Command | Key output |
|---|---|
| `bun --version` | `1.3.14` (**`package.json` pins `bun@1.4.4`; CI uses 1.4.4**) |
| `uv --version` | `uv 0.13.5 (2026-10-21)`; `uv run python --version` → `Python 3.11.17` |
| `git log --oneline -5` | `b841759` docs: Run 0 prompt · `ba7482a` handoff · `517e249` Demand analysis page · `ccc87dc` fix(engine) enum · `fc36c93` feat(web) design system |
| `git status --short` (start) | empty (clean). Local branches: `main`, `sim-run-policy-mine` (old, `15c9b29`) |
| `bun run setup` | exit 0; uv installed 35 packages (highspy 1.15.1, pulp 3.3.2, pandas 3.1.0, numpy 2.4.6, scipy 1.17.1, pyarrow 26.0.0) |
| `git status --short` (after setup) | ` M bun.lock`. Bun 1.3.14 rewrote `lockfileVersion` 2 → 1 and dropped `libc` fields (20+/18−). **I reverted it with `git checkout -- bun.lock`** because it was a side effect of my run. |

### Step 2: tests and build

| Command | Result |
|---|---|
| `bun run typecheck` | `Tasks: 3 successful, 3 total` (web, types, backend), 15 s |
| `bun run test` (194 s wall) | `@dia/types: 8 pass, 0 fail` · `@dia/backend: 29 pass, 6 skip, 0 fail, Ran 35 tests across 5 files` (the 6 skips are `backend + engine (source mode)` e2e, opt-in with `E2E=1`) · engine: `144 passed, 22139 warnings in 148.81s` (warnings are PuLP `LpVariable` deprecation and Starlette `httpx` deprecation) |
| `bun run --cwd apps/dia-web build` | `built in 4.47s`, exit 0. Warning: `NetworkMap-*.js` 1,078.60 kB (> 500 kB chunk limit) |

During the test run, `.env.example` (tracked) changed. `git diff` shows one line: a commented `# GEMINI_API_KEY=` became an uncommented `GEMINI_API_KEY=` followed by a value of the `AQ.` key form. I printed only the first four characters. The file's mtime (05:38:04) equals the mtime of the git-ignored `.env`. No code in `apps/dia-backend/src`, `apps/dia-backend/test`, `packages/dia-types/scripts` or `engine/dia-engine` writes files named `.env*` (searched `writeFile|appendFile|Bun.write`, `.env|write_text|open(..."w"`). I did not open `.env` and did not touch `.env.example`.

### Step 3: data, engine and API

| Command | Key output |
|---|---|
| `data/` before | only `data/backend/vitaran.db*`; no `data/engine/` |
| `uv run --package dia-engine dia-engine weather --fetch` | `cached 13104 rows for 16 cities`, 18 s |
| `uv run --package dia-engine dia-engine generate --seeds 3` | `seed01 revenue_per_distributor_cr_per_year=5.53, diwali_snacks_uplift=1.56, beverage_may_vs_dec=2.08, history_stockout_rate=0.04, ambient_tonnes_per_distributor_week=7.16, sunday_vs_monday=0.61`; seed02 and seed03 created; 3 s total |
| `bun run dev` (background) | `dia-backend on http://localhost:8000 (engine: source, docs: /docs)`; Vite on :3000 |
| `GET /v1/health` | `{"status":"ok","engine_mode":"source","engine":"ok","fake_backend":false}` |
| `GET /v1/ai/status` | `{"enabled":false,"provider":"rules","model":null,"reason":"AI_ENABLED is not true"}` |

`POST /v1/plans` with `{"scenario_id":"seed01","as_of":"2025-09-29","temp_class":...}` (default opening state):

| | ambient (1st, cold) | ambient (2nd, warm) | chilled |
|---|---|---|---|
| plan id | PL-B83A75 | PL-0165BC | PL-E76DA5 |
| wall time of the HTTP call | 11.44 s | 3.70 s | 0.88 s |
| lines / trucks | 290 / 26 (all FTL AMB32) | 290 / 26 | 73 / 19 (all FTL REEF17) |
| `solve.status`, `solve.seconds` | `time_limit`, 2.901 | `time_limit`, 2.3505 | `optimal`, 0.553 |
| `solve.mip_gap` | `null` | `null` | `null` |
| lines with no reason | 0 | 0 | 0 |
| shortfall rows | 312 | 312 | 3 |
| `expected_kpis` (INR) | freight 760,607; lost_margin 6,348,102; holding 4,232; expiry ≈0; total 7,112,940; carbon 7,477 kg; cases 16,071 | identical to cold | freight 225,024; lost_margin 33,308; holding 2,521; expiry 611; total 261,464; carbon 1,699 kg; cases 3,154 |
| reason codes on lines | FESTIVAL_UPLIFT 203, CHEAPEST_SOURCE 168, CREDIT_LIMITED 120, CLIFF_RESCUE 43, STORAGE_LIMITED 18, STOCK_LIMITED 14, FTL_TOPUP 2 | same | FTL_TOPUP 60, CHEAPEST_SOURCE 49, FESTIVAL_UPLIFT 15, CLIFF_RESCUE 6, EXPIRY_PUSH 2 |
| truck fill, mean of max(kg%, m³%) | 93.4% (min 38.3%) | | 91.7% (min 21.1%) |
| freight per kg | ₹4.48 | | ₹8.61 |

Note: `expected_kpis.lost_margin_inr` is weighted by the 2.4 goodwill factor (`optimize.py:287`), so it is a penalty, not margin. The rules text still calls it "expected lost margin ₹63.5 lakh".

| Command | Key output |
|---|---|
| `POST /v1/forecasts` `{"scenario_id":"seed01","as_of":"2025-09-29"}` (0.4 s) | `wape 0.2179`, `wape_seasonal_naive 0.2789`, `bias -0.0072`, `coverage_p10_p90 0.7988`, `wape_festival_weeks 0.2171`; 1,536 rows. `GET /v1/scenarios/seed01/backtest` returns the same numbers. |
| Same backtest on a fresh seed01 in a temp `DIA_DATA_DIR` (synthetic-weather path) | `wape 0.2144`, naive `0.2738`, bias `-0.0037`, coverage `0.7988`, festival `0.2330`. So the weather source does not explain the gap to 14.6%. |
| `GET /v1/scenarios/seed01/history` | 117 weekly points, 48 backtest points, 18 festival windows, `has_band false` |
| `GET /v1/scenarios/seed01/effects` | 8 festivals, 7 weather rows, 7 seasonality categories. Beverages: heat 0.49 %/°C learned vs 4 configured; May seasonality 1.041 vs 1.397 |
| `POST /v1/ai/analyse` `{"kind":"plan","plan_id":"PL-0165BC"}` | `source: rules`, `verified: true`, 1,102 chars, `model: null` |
| same for PL-E76DA5, and `kind: line` | `source: rules`, `verified: true` |
| `gh run list --branch main --limit 5` | 5 × `completed success` (latest `40144776395`, 1m49s) |
| `gh run view 40144776395` | types success · web success · engine success (`144 passed in 64.07s`) · backend success (`29 pass, 6 skip`) · e2e success (`4 pass, 0 fail, 14.58s`). Last 38 runs on main: 35 success, 3 failure (older). |

### Extra measurements (scripts in `%TEMP%`, outside the repo)

- `gt_profile.py`: stage timers and cProfile for one ambient solve. Results are in §5.
- `gt_explain.py`: chilled solve, 5 runs: `[0.608, 0.467, 0.451, 0.455, 0.466]` s; explain 0.06 s. Ambient solve, 3 runs: `[2.689, 2.329, 2.244]` s; explain 1.07 s.
- `gt_runpolicy.py`: one 84-day simulation on seed01, neutral start, in a temp copy of `data/engine`, with the experiment's 1.0 s cap.
  - `baseline_a`: 9.2 s, 40,320 log rows, fill 96.16%, wastage ₹7.85 lakh, FTL utilisation 64.8%, cost to serve ₹2.051 cr.
  - `engine`: **71.5 s**, 40,320 log rows, fill 95.69%, wastage ₹1.59 lakh, FTL utilisation 83.2%, cost to serve ₹1.670 cr.
  - Neither run tripped the per-day conservation assert (`simulate.py:358-366`).

At the end: dev stack stopped (ports 8000, 7010 and 3000 free), `bun.lock` restored, temp data removed. `git status --short` shows only ` M .env.example` (not mine) plus this file.

---

## 3. Claim table

| ID | Claim | How verified | Result | Evidence | Status |
|---|---|---|---|---|---|
| C1 | Public API has 23 routes | Counted `ROUTES`, the `app.ts` handlers and the test assert | `ROUTES` has 23 entries; `app.ts` has 25 handlers (23 `/v1` plus `/openapi.json` and `/docs`); the test expects 23 paths | `apps/dia-backend/src/openapi.ts:6-29`; `app.ts:96-302`; `test/journey.test.ts:84` `expect(Object.keys(doc.paths).length).toBe(23)` (passes) | CONFIRMED |
| C2 | stockout ×2.4; alt_depot 600; chilled 600; REEF17 1500 kg | Read config | All four as stated | `packages/dia-config/config.yaml:133` `stockout_penalty_x_margin: 2.4`; `:8` `alt_depot_max_km: 600`; `:9` `chilled_max_km: 600`; `:125` `REEF17: {..., kg: 1500, m3: 9}` | CONFIRMED |
| C3 | Receipts before dispatch; write-off on every lot | Read code | Receipts land at `simulate.py:280-284`, before planning at `:289-295`. The write-off loop covers every lot in `lots_by` with `p_off = review/shippable` (1 if shippable ≤ review) | `sim/simulate.py:280-284`; `optimize/optimize.py:173-181` | CONFIRMED |
| C4 | MIP cap 1.5 s; sim cap 1.0 s; ambient status `time_limit` | Code plus 5 ambient solves | Caps as stated. Every ambient solve returned `time_limit`; chilled returned `optimal`. `solve.seconds` includes model build and rounding, not only the search (`optimize.py:65, 240-247`) | `optimize.py:26` `MIP_BUDGET_S = 1.5`, `:241`; `simulate.py:406` `SIM_TIME_LIMIT_S = 1.0`, `:419, :427`; API: `solve.status time_limit` | CONFIRMED |
| C5 | Every engine plan is validated in `make_plan`; nobody else calls optimize/explain/validate | Searched all non-test `.py` for imports and calls | `make_plan` validates at `pipeline.py:41` (fallback) and `:46`. Outside the pipeline, only `sim/simulate.py:21` imports `validate`, and `:295` calls it on **every** policy's plan. Engine plans are therefore validated twice; baseline plans once. `optimize` and `explain` are called only from `pipeline.py:35, :45` (and tests). | see §4 D5 for the assessment | CONFIRMED (code); rule text DIFFERS |
| C6 | Quantities never come from the AI layer | Read `src/ai/*.ts` and the `/v1/ai/analyse` route | The model gets `SYSTEM_PROMPT` + `FACTS (JSON)` (aggregates built by `facts.ts`) + a task string. The task can contain the user's free-text question, capped at 500 chars (`app.ts:302-324`; `analyse.ts:117-122`). The route returns `{text, source, model, verified, unverified_numbers, note}` and writes nothing to a plan or the repo. The number check only flags; it never blocks (`analyse.ts:85-105, 132-134`). | `analyse.ts:109-138`; `facts.ts:12-108`; `app.ts:302-324` | CONFIRMED, with one nuance: the input also contains user text, not only computed facts |
| C7 | `FAIR_SHARE_FLOOR` never emitted; the other ten each tested | Read `explain.py` and `tests/test_explain.py`; ran the suite | `explain.py` builds Reasons for 10 codes (`:104, 108, 111, 129, 143, 151, 159, 171, 175, 188, 195`) and never references `FAIR_SHARE_FLOOR`. Tests: CHEAPEST_SOURCE `:63`, EXPIRY_PUSH `:67`, CLIFF_RESCUE `:71`, FTL_TOPUP `:75`, FESTIVAL_UPLIFT `:79`, CREDIT_LIMITED `:84`, WEATHER_SHIFT `:88` (forced hot forecast), STOCK_LIMITED `:94` (lots ×0.05), STORAGE_LIMITED `:102`, MRSL_BLOCKED `:109` (alt depots allowed to 5,000 km), and a negative test for FAIR_SHARE_FLOOR at `:120`. All pass (144/144). On real seed01 plans, WEATHER_SHIFT and MRSL_BLOCKED never appear. | as listed | CONFIRMED |
| C8 | Real weather when `weather_daily.parquet` exists, synthetic otherwise; which is in use | Read `data/weather.py`; checked the file | **Real** in this clone: fetched by `weather --fetch`; 13,104 rows, 16 cities, 2023-09-25 to 2025-12-21; Delhi May mean tmax 39.8 °C, Jan 18.9 °C (synthetic gives 40.1 / 20.9). Caveat: `load_weather` **also caches the synthetic fallback under the same table name** (`weather.py:67-75`), so the file existing does not prove the weather is real. No source column records it. | `weather.py:24-39, 67-75`; `generate.py:236` | CONFIRMED (with caveat) |
| C9 | Result of record from `EX-de4798536119`, not in git | Checked git, computed the run size, timed one engine run | Cannot reproduce from the repo alone: `data/` is git-ignored and was absent before this run. Re-run needs: weather fetch (network), seeds 1–10 (about 1 s each here), then `POST /v1/experiments`. Size: seeds 1–5 run 2 states × (engine + 3 ablations + 2 frontier = 6 engine runs + 9 baseline/frontier runs); seeds 6–10 run 2 states × 3 headline runs. At the measured 71.5 s per engine run and 9–18 s per baseline run, the slowest seed process is about 17–19 min; with 10 worker processes on 12 cores and contention, I estimate **20–40 min** (Handoff says about 1 hour). Results will not match bit-for-bit: every solve stops on a wall-clock limit (`optimize.py:241`, 1.0 s in experiments), so the incumbent depends on machine speed and load. One seed (seed01, neutral, engine vs A): cost −18.6%, wastage −80%, fill −0.47 pp, FTL 83% vs 65%. That is the same direction as the record, but not the record. | `.gitignore` (`data/`); `simulate.py:407, 431-474, 502-503`; `gt_runpolicy.py` output | UNVERIFIED |
| C10 | CI has five jobs; latest `main` result | `gh` CLI (logged in as AmeyKuradeAK, read access) | 5 jobs, all success on `b841759`. Engine 144 passed; backend 29/6 skip; e2e 4 pass; types 8 pass; web built. No red job to reproduce. | run 40144776395 | CONFIRMED (green; Handoff's "nobody has looked" is out of date) |
| C11 | The nine known gaps are real | Per gap below | 7 confirmed, 2 unverified | §3.1 | mixed |
| C12 | No secrets tracked or in history | `git ls-files`, `git log --all -p -G`, `git grep` | Tracked: only `.env.example` matches the env/key/data patterns; `.env` is ignored (`.gitignore:17`). History (all refs): `AQ.` key form 0, `AIza` key form 0, `"private_key":` 0. `BEGIN PRIVATE KEY` appears once, in `b841759`, inside the Run 0 prompt text itself (not a key). **Working tree:** `git grep -l` finds a key-like `AQ.` string in `.env.example` (uncommitted; HEAD clean). | commands in §2 | DIFFERS (working tree only) |

### Other Handoff numbers checked

| ID | Claim (source) | Result | Status |
|---|---|---|---|
| H1 | Forecast WAPE 14.6% vs naive 29.3%, bias −0.6%, coverage 79.9%, festival WAPE 15.3% (`Handoff.md:13`, `Demo.md:65`, `Phases.md:13`, `Memory.md:14, 39`) | WAPE 21.8%, naive 27.9%, bias −0.7%, coverage 79.9%, festival 21.7%. Bias and coverage match; WAPE does not. `forecast.py` is unchanged since `fce0fab` (the forecast PR, where 14.6% was logged); `generate.py` and `config.yaml` changed afterwards in `d3859ae` (dairy ×3, REEF17), `ea2abef` (chilled network) and `85b469d` (real weather). The cause is likely the generator changes; not proven. | DIFFERS |
| H2 | Tests: backend about 29 pass + 6 skip, engine about 144 | 29/6/0 and 144/0/0, locally and in CI | CONFIRMED |
| H3 | Ambient solve about 2–4 s; chilled under 1 s (`Handoff.md:15`) | Ambient `solve.seconds` 2.24–2.90 s; chilled 0.45–0.61 s. PRD 8.4 targets are 2 s ambient and 0.5 s chilled p95, so ambient misses and chilled sits at the limit. API wall time is longer: 3.7 s warm, 11.4 s cold. | CONFIRMED |
| H4 | 0 stock-conservation failures in 483,840 rows (`Handoff.md:18`) | Not re-run. Two runs here (2 × 40,320 rows) passed the per-day assert. | UNVERIFIED |
| H5 | Chilled freight ₹8.8/kg vs ambient ₹4.6 (Gap 8, B04) | ₹8.61 vs ₹4.48 on one seed01 plan of each class | CONFIRMED (approximately) |
| H6 | Learned heat 0.5 vs 4 %/°C; May peak 1.04 vs 1.40 | 0.49 vs 4; 1.041 vs 1.397 | CONFIRMED |
| H7 | An engine simulation run takes about 2 minutes (`Backlog.md:70`; `Memory.md:23` "110–130 s") | 71.5 s here (54 plan days) | DIFFERS (machine-dependent) |
| H8 | Full experiment about 1 hour on 12 cores | Not run; estimate 20–40 min (C9) | UNVERIFIED |
| H9 | Needs Bun 1.4.4 | 1.3.14 installed; it downgraded `bun.lock` on install. CI uses 1.4.4 and passes. | DIFFERS (local environment) |
| H10 | `bun run test` about 2 minutes | 194 s locally (engine 149 s); CI engine job 64 s | DIFFERS (minor) |
| H11 | 49 assumption rows, each with a source or `judgment` (Memory) | `GET /v1/assumptions` returns 49 rows; in `config.yaml` 50 inline `{...}` rows after line 148 all have `source:`, 32 of them `judgment` | CONFIRMED |

### 3.1 The nine known gaps (`docs/Handoff.md` §6)

| # | Gap | Evidence | Status |
|---|---|---|---|
| 1 | Fill rate below the best baseline; the lost-sales curve counts shipped stock from day 0 | Code: `optimize.py:129-150` builds `ls ≥ A − G·z` with `z = I + Σx`, where `I` = on-hand + all in-transit (`:130-133`), on a window starting at `as_of` (`targets.py:77-78`). The simulator delivers at `day + ceil(lead) + delay` (`simulate.py:301-309`). Numbers: seed01 neutral, engine fill 95.69% vs A 96.16%. The cause is plausible from the code but not isolated by an experiment. | CONFIRMED (gap); cause UNVERIFIED |
| 2 | Ablations on 5 seeds; (c) and (f) dropped; uniform service cheaper | `simulate.py:407` `SUBSET_SEEDS = 5`; `apps/dia-web/src/api.ts:32-35` `MAIN_EXPERIMENT` lacks `abl_no_credit` and `abl_home_depot` (both exist in `simulate.py:35, 37`). "Cheaper" is a result-of-record number. | CONFIRMED (config); result UNVERIFIED |
| 3 | Seasonality and heat learned weakly | `/effects`: beverages heat 0.49 vs 4; May 1.041 vs 1.397; dairy heat 0.2 vs 2.5. `forecast.py:144` divides by a centred 9-week rolling median. | CONFIRMED |
| 4 | Ambient solve above 2 s | 2.24–2.90 s `solve.seconds`, always `time_limit` | CONFIRMED |
| 5 | FR8 fit and diesel price not independently verified | `config.yaml:195` "Least-squares fit to 8 FR8 32 ft SXL market rates (A11)"; `:196` "Upstox, Mumbai retail diesel, Oct 2026". No raw quotes are in the repo, so no check is possible. | CONFIRMED (no evidence in repo) |
| 6 | Gemini path run live once; Vertex only mocked | `test/ai.test.ts:88` (mock model), `:117` (mocked Vertex HTTP). No key was used in this run. | UNVERIFIED (live path) |
| 7 | Map needs network tiles; offline rehearsal not done | `apps/dia-web/src/components/NetworkMap.tsx:78` OSM tile URL; `apps/dia-web/index.html:7-8` Google Fonts. No offline run was done here. | CONFIRMED (dependency); rehearsal UNVERIFIED |
| 8 | Chilled freight about ₹8.8/kg vs ₹4.6 | ₹8.61 vs ₹4.48 (§2) | CONFIRMED |
| 9 | No web unit tests | 0 `*.test.*`/`*.spec.*` files under `apps/dia-web` (excluding `node_modules`); CI web job runs only `tsc` and `vite build` | CONFIRMED |

---

## 4. Discrepancies (docs vs repo), with the line to fix

| # | Where | Docs say | Repo / measurement | Fix |
|---|---|---|---|---|
| D1 | `docs/Handoff.md:13`, `docs/Demo.md:65`, `docs/Phases.md:13`, `docs/Memory.md:14, 39` | WAPE 14.6% vs 29.3% naive, festival 15.3% | 21.8% vs 27.9%, festival 21.7% (seed01, current code and data) | Replace with measured numbers before any demo. Also fix the Demand page text if it quotes them. |
| D2 | `docs/Handoff.md:22`, `docs/Backlog.md:28` (B01) | CI never looked at | 5/5 green on `b841759`; 35 of the last 38 main runs green | Mark B01 done. |
| D3 | `docs/Rules.md:13`, `.kiro/steering/structure.md:18`, `engine/.../optimize/pipeline.py:4` | Nobody but `make_plan` calls `validate` | `sim/simulate.py:21, 295` validates every policy's plan | Reword (see D5). |
| D4 | `docs/Handoff.md:68` | The simulator validates baseline plans directly | It validates **all** plans, engine included (`simulate.py:295`), so engine plans are validated twice | Say "every policy's plan". |
| D5 | Assessment of C5 | — | This is a sensible exception, not a defect. The simulator must apply one independent checker to every policy, including baselines that never pass through `make_plan`, or the comparison is not fair. The double check of engine plans costs about 2 ms. What I would change: the rule text, to "`make_plan` and the simulator call `validate`; only `make_plan` calls `optimize` and `explain`". Code stays as is. One real bug sits next to it: the Baseline B fallback in `make_plan` ignores `locks` (`pipeline.py:38`), so a solver failure during an inbox re-solve would raise `PlanInvalid`, which reaches the user as a 500. | Doc change now; fallback-with-locks is a separate small item. |
| D6 | `docs/Rules.md:52` | Timeout 30 s; incumbent if gap ≤ 5%, else round and repair | Search capped at 1.5 s (`optimize.py:241`); no gap check; `mip_gap` is never filled (`optimize.py:305-306`; API shows `null`); there is no round-and-repair path | Update Rules.md to the actual behaviour, or implement the gap report as part of B10. |
| D7 | `engine/.../optimize/optimize.py:306` | — | `solver="highs"` is hard-coded even when `_solver` falls back to CBC (`:53-57`) | Note for B10. |
| D8 | `docs/Architecture.md:152` | Vertex model `gemini-4-argon` | `apps/dia-backend/src/env.ts:55` defaults to `gemini-2.5-flash`; `:61` Gemini API `gemini-flash-latest` | Fix the doc. |
| D9 | `docs/Architecture.md:160-169` | `get_snapshot`, `run_experiment`, `freight`, `solve`, `explain`/`validate`, `apply_response` "to build" | All built and tested | Mark done. |
| D10 | `docs/Architecture.md:51` | `tools/release/` exists | It does not | Remove the line or mark it future (B15). |
| D11 | `docs/Memory.md:6-10` (Project status) | 17 endpoints; optimize and sim are stubs; Kiro steering removed | 23 routes; all built; `.kiro/steering/` has 4 files | Rewrite the status block. |
| D12 | `docs/Memory.md:52-56` (Open issues) | Chilled freight 25–30% of value; replace `climate.yaml` by real fetch | REEF17 LCV and dairy ×3 landed (`d3859ae`); real weather landed (`85b469d`) | Close those items. |
| D13 | `docs/Memory.md:23`, `docs/Backlog.md:70` | Engine sim run 110–130 s / about 2 min | 71.5 s on this machine | State it as machine-dependent. |
| D14 | `docs/Backlog.md:86` (B14) | Root `app/__pycache__/` to delete | Does not exist | Drop it from B14. |
| D15 | `package.json` `packageManager: bun@1.4.4`; `docs/Handoff.md` §2 | Bun 1.4.4 | The new owner has 1.3.14, which rewrites `bun.lock` on `bun install` | Owner installs 1.4.4 before any commit. Never commit a `lockfileVersion: 1` lockfile. |
| D16 | `docs/Backlog.md:71` (B10) | "Model build is about 1 s (cache window distributions, avoid recomputing `expected_leftover`)" | Build is 0.70–1.20 s. The main costs are `_lost_sales_segments` (quantiles + `expected_shortfall`) and `window()` per arc, plus `explain` (1.07–1.87 s) that the item does not mention | Update B10 with §5. |
| D17 | `engine/.../optimize/optimize.py:287` vs `apps/dia-backend/src/ai/analyse.ts` `planRules` | "expected lost margin" | The figure is lost cases × 2.4 × margin (a goodwill penalty, not margin) | Rename in the text, or show both. |
| D18 | `docs/PRD.md:297, 753, 795` | 20 seeds headline, 10 for ablations; full experiment ≤ 25 min | 10 and 5 (`simulate.py:407`); Handoff says about 1 hour | PRD deviation, already disclosed in Handoff; keep it in the Results caveats. |
| D19 | `packages/dia-config/config.yaml:2, 147`; module docstrings (`targets.py:1`, `pipeline.py:1`, `dist.py:1`) | Owners M1–M4 | Solo build | Cosmetic. Editing `config.yaml` text changes the experiment id, so do it after B13. |
| D20 | Memory `make_plan` entry (`docs/Memory.md`, Phase 1 step 6) | Ambient 171 lines / 30 trucks; chilled 18 / 4 | 290 / 26 and 73 / 19 now | Historical; no fix needed, but do not quote the old figures. |
| D21 | `.env.example` (working tree) | Lists variable names only | Holds a key-like value, uncommitted | Owner restores the file (`git checkout -- .env.example`) after copying anything needed into `.env`, and rotates the key. |

---

## 5. Facts for B05 and B10

### B05: lost-sales window and lead time

- **Where the curves are built.** `optimize/optimize.py:129-150`. For each (SKU, distributor) target: `z = pos[key] + lpSum(x over arcs into j)` (`:139`), then `ls ≥ A − G·z` for the segments from `_lost_sales_segments(tg.mu, tg.sigma², lost_sales_breakpoints)` (`:145-146`). Objective: `pi·ls + h·(z − mu + ls)` (`:147-150`), with `pi = 2.4 × margin × pi_mult`.
- **Segment construction.** `optimize.py:34-39` builds breakpoints at quantiles `[0, .10, .25, .50, .75, .90, .98]` (`config.yaml:115`) of the window distribution (`forecast/dist.py:28-35`, NB or Poisson), and evaluates `expected_shortfall` (`dist.py:54-59`) at each breakpoint.
- **Where the window is built.** `forecast/targets.py:63-84`. `mu, var = window(pf, pf.start, cover)` (`:78`), where `pf.start` is the forecast start (`as_of`) and `cover = cover_days(...)` (`:31-46`) = `cadence_days[class] + ceil(L)`. For ambient, the window is extended to the Sunday after an upcoming festival run (lookahead from `festival_prebuild`); chilled never extends. Cadence: ambient 7, chilled 2 (`config.yaml:110`).
- **How lead time enters.**
  1. Only as window length: `L` = `lead_days_mean` of the **home** depot lane (`targets.py:70, 76`), rounded up (`:34`). The window always starts at day 0.
  2. `pos` (on-hand + **all** in-transit, `optimize.py:130-133`) and the new shipments `x` are counted against the whole window, so cases arriving at day L also "serve" demand on days 0 to L−1.
  3. Lead is also used for the arc MRSL filter (`optimize.py:102-104`) and the waste window `tau = RSL − lead` (`:159-160`), but not for the lost-sales curve.
- **Sizes on seed01.** Home-lane `lead_days_mean` is 1 day for 7 distributors (≤ 278 km) and 2 days for 9 (330–860 km); `p_delay` is 0.1 on every lane. So in ambient, 1–2 days of an 8–9-day window are out of reach of `x` (11–22%). In chilled, 1–2 days of a 3–4-day window are out of reach (33–50%), so chilled is affected most.
- **Simulator timing.** Lines ship on the plan day and arrive on `day + ceil(lead_days_mean) + extra` with `extra = 1` at probability `p_delay` (`sim/simulate.py:301-309`). On the arrival day, arrivals are booked before sales (`:318-323` before `:325-339`), so a 1-day lane sells the shipment from day 1. The delay day is random, but the planner's window never includes it.
- **Targets vs constraints.** `S = mu + z·sigma` is reported only (`targets.py:82`); the MILP uses `tg.mu` and `tg.sigma` directly. Changing the window in `compute_targets` also changes `S`, the `critical_ratio` cover term (`targets.py:57`), reason codes and the baselines that use targets.
- **What a design must decide** (facts only, no design): whether demand in `[0, L)` is served from `I` only; whether in-transit stock should count by arrival day (the snapshot's `in_transit` rows carry arrival info that is currently ignored); whether non-home arcs need their own lead (today none qualifies, because of the 600 km gate); and how the extra delay day is treated.
- **Existing tests near this code:** `tests/test_optimizer.py:43-76`, `tests/test_explain.py`, and the `dist` tests (Memory: within 2% of Monte Carlo). The ambient solve-time test allows 6 s (`test_optimizer.py:50`).

### B10: solve time (ambient seed01, imbalanced, 2025-09-29; `gt_profile.py`, `gt_explain.py`)

| Stage | Seconds | Where |
|---|---|---|
| `get_snapshot` (first call; cached after) | 4.39 | `sim/simulate.py:76` |
| `forecast` | 0.06 | `forecast/forecast.py:416` |
| `compute_targets` | 0.04 | `targets.py:63` |
| `optimize.solve`: model build | 1.20 first / 0.70 warm | `optimize.py:65-238` |
| `optimize.solve`: `pulp.solve` (HiGHS, includes PuLP hand-off) | 1.55 / 1.59 (cap 1.5 s; status `time_limit` every time) | `optimize.py:241` |
| `optimize.solve`: rounding, `build_loads`, expected KPIs | 0.14 / 0.17 | `optimize.py:251-311` |
| **`solve.seconds` reported** | 2.75 / 2.28 (API: 2.90 / 2.35; three more runs: 2.69, 2.33, 2.24) | includes all three parts above |
| `explain.add_reasons` | 1.07–1.87 | `optimize/explain.py:25` |
| `validate.validate_plan` | 0.002 | `optimize/validate.py:30` |
| HTTP `POST /v1/plans` wall | 11.4 cold / 3.7 warm | backend + engine |

- **Model size:** 1,082 variables, 2,414 constraints, 637 arcs, 16 lanes (home depots only, because of the 600 km gate), 29 waste curves. The PRD estimated about 3,500 shipment variables.
- **Inside the build** (cProfile, which inflates times; the total was 3.88 s under the profiler):
  - `_lost_sales_segments`: 320 calls, 0.97 s cumulative. Of that, `quantile` → scipy `ppf` 2,414 calls (0.53 s) and `expected_shortfall` 2,880 calls (0.59 s) → `_below` sums the pmf over 0..⌊z⌋ (`dist.py:46-51`).
  - `window()`: 927 calls, 0.55 s. It is a Python list comprehension over days (`dist.py:24-25`), and the C8 loop calls it for every arc **before** the materiality check (`optimize.py:164-165`); only 29 of 637 arcs keep a curve.
  - `expected_leftover`: 1,101 calls, 0.32 s.
- **Inside explain:** `explain.py:137` (a list comprehension calling `waste()` at `:78`) runs 3,282 `window` + `expected_leftover` evaluations, 1.9 s of a 2.1 s profiled call. This sits outside `solve.seconds`, but the user pays for it on every plan.
- **HiGHS** always uses the whole budget. `mip_gap` is not reported (`optimize.py:305-306`), so there is no evidence of how close the incumbent is at 1.5 s, or at 1.0 s in the simulator. Two identical ambient requests gave identical `expected_kpis`, so the incumbent was stable on this instance; that is not guaranteed under load.
- **Chilled:** `solve.seconds` 0.45–0.61 s, status `optimal`; explain 0.06 s. The PRD target is ≤ 0.5 s p95, so chilled sits at the limit.
- **Simulator impact:** an engine run is 54 plan days (12 ambient, 42 chilled) and took 71.5 s, about 1.3 s per plan day.

---

## 6. Backlog adjustments

| Item | Change | Evidence |
|---|---|---|
| **New B00 (first, owner)** | Restore `.env.example`, rotate the Gemini key, then install Bun 1.4.4 | D21, C12; D15 |
| B01 | **Drop** (done) | C10: 5/5 green on `b841759` |
| **New B01a (HAIKU, S)** | Replace the stale forecast numbers in `Demo.md:65`, `Handoff.md:13`, `Phases.md:13` and any web copy; optionally pin seed01 WAPE in `test_forecast.py` with a tolerance so docs and code cannot drift | D1 / H1 |
| B13 | **Move ahead of B05 and B10, and widen it:** hash only parameter + value, **and add a code version** (engine package version or git sha) to the experiment id. Otherwise B05 and B10 results are silently served from the old cache. | `app.ts:272-273`; C9 |
| B05 | Keep as OPUS. Add to the design questions: in-transit counted by arrival day; the delay day; the chilled share (33–50% of the window is unreachable). Note that the change touches `targets.py`, so `S`, `critical_ratio`, reason codes and the baselines all move. | §5 B05 |
| B10 | **Split:** (a) HAIKU-sized after a short Opus note: report `mip_gap` and the real solver name (D6, D7), and move the C8 materiality check before `window()`. (b) OPUS: vectorise or cache `_lost_sales_segments`, `window` and the explain waste loop. (c) OPUS: HiGHS warm start and tighter bounds. Measure `solve.seconds` **and** API wall time separately; explain alone is 1–1.9 s. | §5 B10 |
| **New (small)** | Baseline B fallback must respect `locks` in `make_plan`, or re-solve fallback returns 500 | `pipeline.py:36-43`; D5 |
| **New (doc)** | Reword the validator rule in `Rules.md:13`, `structure.md:18` and `pipeline.py:4`; fix `Rules.md:52`; fix the Architecture lines in D8–D10; Memory status D11–D12 | D3–D12 |
| B06, B07, B08 | Unchanged, but each needs compute: about 20–40 min per full run on this machine, more with 10-seed ablations (B07 roughly doubles engine runs for seeds 6–10). Run them after B13. | C9 |
| B14 | Drop `app/__pycache__/` (does not exist); keep the rest | D14 |
| B04 | Unchanged; the ₹/kg figures are confirmed (₹8.61 vs ₹4.48). It edits `config.yaml` text, so do it after B13. | H5 |
| B02 | Unchanged; dependencies confirmed (`NetworkMap.tsx:78`, `index.html:7-8`) | Gap 7 |

Suggested order: B00 → B01a → B13 → B03 → B05 design ∥ B10a → B04 → B02 → B10b/c → B06 → B07 → B08 → B09 → B11/B12 → B14.

---

## 7. Questions for the owner

1. **Key and `.env.example`.** The tracked `.env.example` has a key-like value that appeared during this run (05:38). Did you put it there? Please restore the file, keep keys only in `.env`, and rotate the key that was pasted in chat. Is that the same key?
2. **Bun version.** Can you install Bun 1.4.4? With 1.3.14, every `bun install` rewrites `bun.lock` into an older format.
3. **GitHub access.** `gh` here is logged in as `AmeyKuradeAK` with read access. Will this account push to `paras6999/...` `main` directly, or through PRs? Should branch protection require the five CI checks now that there is a second person?
4. **dia-fallback-ui.** `apps/dia-fallback-ui/` (4 tracked files, unmaintained Streamlit) is still listed in Architecture and Rules. Keep or delete?
5. **Compute budget.** One full experiment is about 20–40 min here (estimated), and B05, B06, B07, B08 and B09 each need at least one. How many full runs can we spend, and on which machine? Results depend on machine speed because solves stop on a wall clock, so the result of record should come from one fixed machine.
6. **Result of record.** The stored `EX-de4798536119` exists only on the builder's machine. Do we re-run it here as the new baseline before B05, and accept that the numbers will move slightly?
7. **Forecast numbers in the pitch.** Use the measured 21.8% (vs 27.9% naive) from now on, or investigate why it rose from 14.6% first?
8. **PRD deviations.** 10/5 seeds instead of 20/10, the 2.4 stockout weight, and receipts before dispatch: keep them as disclosed deviations, or bring the PRD in line?
9. **Memory.md.** `AGENTS.md` asks for a Memory line after each task, but this run was limited to `docs/Ground-truth.md`. Should I add one in the next run?
