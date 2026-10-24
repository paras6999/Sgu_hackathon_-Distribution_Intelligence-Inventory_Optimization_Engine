# Handoff.md — Vitaran (DIAgent) for the next owner

Written 25 Oct 2026 for the team member taking over in **Kiro**. Read this file first, then `docs/Kiro.md` (how to run the work with Kiro and the two models), then `docs/Backlog.md` (what to do next).

Vitaran is a distribution-planning engine for a consumer-goods brand: each planning cycle it decides **which SKU, from which depot lot, to which distributor, how many cases, in which truck**, shows the reason for every line, and proves itself in a simulation against two baselines. It was built in about 24 hours by one person with Claude Code, against a hackathon problem statement that accepts simulated data if the assumptions are stated and realistic.

---

## 1. State in one screen

| Area | State |
|---|---|
| Forecast (ETS / TSB, festival, weather, promo factors learned from 2 years of history) | Built. Backtest on seed01: WAPE 14.6% vs 29.3% naive, bias −0.6%, P10–P90 coverage 79.9%, festival-week WAPE 15.3%. |
| Targets (newsvendor service levels) | Built. |
| Optimiser (MILP, PuLP + HiGHS) | Built. Ambient solve about 2–4 s (the search is capped at 1.5 s, status `time_limit`), chilled under 1 s. |
| Reason codes (11) and validator | Built. Every plan is re-checked by an independent validator before it is returned. `FAIR_SHARE_FLOOR` never fires (switched off by default). |
| Distributor loop (accept, trim, reject, locked re-solve) | Built. About 2 s. |
| Simulator, KPIs, experiment runner, baselines A and B | Built. 0 stock-conservation failures in 483,840 rows. |
| Web app (8 screens), API (23 routes), AI analysis | Built. Redesigned 24–25 Oct. |
| Real weather (Open-Meteo), 2-year history | Built. |
| Final experiment `EX-de4798536119` | Run (10 seeds × 2 opening states; ablations and frontier on seeds 1–5). **Stored in `data/engine`, which is not in git**: a fresh clone must regenerate data and re-run (about 1 hour). |
| CI | Defined in `.github/workflows/ci.yml`. **Nobody has looked at the results** (no GitHub access from the build sessions). Check first (Backlog B01). |

Result of record (engine against the better of the two baselines; neutral / imbalanced opening state): cost to serve −15% / −15%, wastage −72% / −82%, freight per case −20% / −19%, CO₂ per case −22%, FTL utilisation 80% (target 85%); **fill rate −0.4 / −0.8 points** (target was +2 / +4), stockout rate +0.4 / +0.9 points. Four of ten PRD targets met. Full numbers: `docs/Demo.md`.

## 2. Run it from a fresh clone

Needs [Bun 1.4.4](https://bun.sh), [uv](https://docs.astral.sh/uv/), Python 3.11+ (uv installs it), a network for the first run.

```bash
git clone <repo> && cd <repo>
bun run setup                                   # bun install + uv sync --all-packages
uv run --package dia-engine dia-engine weather --fetch      # real Open-Meteo history, cached once (needs network)
uv run --package dia-engine dia-engine generate --seeds 10  # scenarios seed01..seed10 into data/engine
bun run test                                    # types + backend + engine; about 2 minutes
bun run dev                                     # web :3000, backend :8000, engine :7010
```

`bun run data` only generates seed01. `bun run dev:fake` runs the web and backend on fixture data with no engine (good for UI work; shows a "Demo data" status).

**Run the evaluation** (about 1 hour on 12 cores; the Results page does this on first visit, or call it yourself):

```bash
curl -X POST localhost:8000/v1/experiments -H "content-type: application/json" \
  -d '{"policies":["engine","baseline_a","baseline_b","abl_no_expiry","abl_no_truck_steps","abl_uniform_service"],"seeds":10,"opening_states":["neutral","imbalanced"]}'
```

The experiment id is a **hash of the full assumptions table (including its text) plus the request**. Editing a source or rationale in `packages/dia-config/config.yaml` changes the id, so the web pages will start a new run instead of finding the cached one (Backlog B13 removes this).

### Secrets (read this)
- `.env` lives in the repo root and is git-ignored. `.env.example` lists every variable. The backend reads the root `.env` itself (`apps/dia-backend/src/env.ts`); Bun alone would not.
- The AI analysis is **off unless `AI_ENABLED=true`** and a key is set (`GEMINI_API_KEY`, default model `gemini-flash-latest`; or Vertex AI variables). With it off, the Analyse buttons still work from rules and templates, offline.
- A Gemini key was pasted into a chat during the build. **It must be rotated** (delete it in Google Cloud Console, create a new one, put it in your own local `.env`). No key is in the repo or its history.
- Never put keys in code, docs, tests, logs or commits. Tests use mocks.

## 3. Architecture in two minutes

```
apps/dia-web (React + Vite, :3000) ──/v1──▶ apps/dia-backend (Bun + Hono + SQLite, :8000) ──▶ engine/dia-engine (Python + FastAPI, :7010, parquet)
                              packages/dia-types: ONE JSON Schema → TypeScript and pydantic types
                              packages/dia-config: config.yaml (every business number) + climate.yaml (offline weather fallback)
```

- **The web app calls only `/v1`.** The backend calls the engine only through `EngineClient` (`apps/dia-backend/src/engine/client.ts`; implementations `http.ts` and `fake.ts`). Nobody imports across these lines.
- **Python only in `engine/dia-engine`**; TypeScript on Bun everywhere else.
- **The engine owns analytical data (parquet in `data/engine/`); the backend owns app state (SQLite in `data/backend/`).** Only `store.py` touches parquet; only `db/repo.ts` touches SQLite.
- **Quantities come only from the optimiser or a baseline, never from an LLM.** The AI layer explains numbers; every figure it quotes is checked against the data (`apps/dia-backend/src/ai/analyse.ts`).
- Everything that plans (the API and the simulator) goes through `optimize/pipeline.make_plan`, which runs forecast → targets → optimise → explain → **validate**. Never return an unvalidated plan.

### Where things live

| Path | What it is |
|---|---|
| `packages/dia-types/schema/*.schema.json` | **Source of truth for every data shape.** Edit these, then `bun run gen:types`. Never edit `ts/generated.ts`, `py/dia_types/models.py` or `dist/` by hand. `fixtures/` are sample payloads used by the fake engine and tests. |
| `packages/dia-config/config.yaml` | Every business number, each with an `assumptions:` entry (unit and source, or `judgment`). `climate.yaml` is the offline weather fallback only. |
| `engine/dia-engine/src/dia_engine/data/` | `generate.py` (simulated scenarios, deterministic per seed), `weather.py` (real Open-Meteo fetch + fallback). |
| `…/forecast/` | `forecast.py` (model, backtest), `dist.py` (window distributions), `targets.py` (service levels), `analysis.py` (history + learned effects for the web). |
| `…/optimize/` | `optimize.py` (the MILP), `freight.py` (the one freight implementation), `validate.py` (independent checker), `explain.py` (reason codes), `pipeline.py` (`make_plan`, locked re-solve for the inbox). |
| `…/baselines/` | Baseline A (proportional split, FIFO) and B ((s, S), FCFS, FEFO), sharing `common.py` and `optimize/freight.py`. |
| `…/sim/` | `simulate.py` (daily loop, snapshots, experiment runner), `kpi.py` (KPIs, confidence intervals, summaries), `policy.py` (the `Policy` interface). |
| `…/service/app.py` | Internal engine HTTP API (127.0.0.1 only). |
| `apps/dia-backend/src/` | `app.ts` (all routes), `engine/`, `db/repo.ts`, `ai/` (facts, rules analysis, Gemini/Vertex client), `openapi.ts`, `env.ts`. |
| `apps/dia-web/src/` | `App.tsx` (shell), `pages/` (Plan, Dispatch, Inbox, Demand, Analytics = Map/Results/Frontier/Assumptions), `components/` (ui, AnalysisPanel, NetworkMap), `theme.css` (design tokens and components), `api.ts`. |
| `apps/dia-fallback-ui/` | Emergency Streamlit app. **Not maintained** after the web app existed; candidate for deletion. |
| `docs/` | `PRD.md` (requirements), `Architecture.md`, `Rules.md`, `Design.md`, `Phases.md`, `Demo.md` (script, numbers, judge Q&A), `Memory.md` (dated log of every decision; read the top 60 lines). |

## 4. The data, and what is real

- **Real:** daily weather for the 16 distributor cities (Open-Meteo archive, 25 Sep 2023 – 21 Dec 2025), city coordinates and populations, Indian festival dates (Diwali 20 Oct 2025).
- **Simulated (deterministic per seed):** daily sales per SKU × distributor (negative binomial around a realistic mean with weekday, season, festival, weather and promotion effects), depot lots, plant receipts, distributor stock and credit, shipment delays. Calibration checks in `engine/dia-engine/tests/test_realism.py` (turnover per distributor, Diwali uplift, summer beverages, about 4% historical stockouts, about 7 t ambient per distributor-week, quiet Sundays, SKU economics, determinism).
- **Network:** 4 depots (Bhiwandi, Gurugram, Hosur, Dankuni), 16 distributors, 24 SKUs (4 chilled dairy). History 25 Sep 2023 – 28 Sep 2025; test window 29 Sep – 21 Dec 2025 (84 days, contains Diwali). Two opening states: *neutral* (every node at forecast × regular cover) and *imbalanced* (one depot's snack lots at 62–70% of shelf life, one region short before Diwali, one distributor overstocked on slow SKUs).
- Unit conventions: INR, **cases** (one carton of identical packs, the unit everything ships in), kg, m³, days. Put units in names (`cost_inr`).

### Modelling decisions made late that are easy to miss
All are in `config.yaml` with an `assumptions` entry, and in `docs/Memory.md` with the evidence.
- `costs.stockout_penalty_x_margin` = **2.4** (PRD says 1.2). Tuned on the frontier of seeds 1–5, which are also evaluation seeds (Backlog B06 fixes this).
- `network.alt_depot_max_km` = 600: alternative depots are 1,000+ km away, so none qualifies and the home-depot ablation (f) is vacuous here. `network.chilled_max_km` = 600: no chilled demand beyond it (Nagpur, Hyderabad, Guwahati).
- Dairy base volumes ×3 and the chilled truck (`REEF17`) is a ~1.5 t refrigerated LCV, not a 17 ft reefer (class code kept for contract stability). Its rates are judgment, not fitted to quotes.
- Plant receipts land **before** dispatch in `run_policy` (PRD §6.6.5 lists them after, which left 2-day-old dairy under the 60% shelf-life floor).
- Depot write-off cost applies to **every** lot (probability = review period ÷ days still shippable), not only lots about to cross the floor.
- Limits on speed: `optimize.MIP_BUDGET_S = 1.5`; the simulator caps engine solves at `SIM_TIME_LIMIT_S = 1.0`; experiments run one process per seed.

## 5. Contracts and how to change them

1. Change a data shape: edit `packages/dia-types/schema/<file>.schema.json` → `bun run gen:types` → update `fixtures/`, the fake engine (`apps/dia-backend/src/engine/fake.ts`) and tests **in the same commit**. CI fails if generated files are out of date (`bun run check:types`).
2. Add a route: `apps/dia-backend/src/app.ts` + a `ROUTES` entry in `src/openapi.ts` + the `EngineClient` method if it needs the engine + fake + test. `test/journey.test.ts` asserts the route count (now 23).
3. Table names and columns in `engine/dia-engine/src/dia_engine/store.py` (`TABLES`) are a contract; `write_table` rejects different columns.
4. `Policy.plan(scenario, snapshot, forecast, temp_class) -> Plan` (`sim/policy.py`) is the interface the simulator uses for the engine and both baselines.

## 6. Known gaps and honest limits (do not hide these in a demo)

1. **Fill rate is below the best baseline** (−0.4 / −0.8 points). Cause: the optimiser's lost-sales curve assumes stock is available on day 0 although a shipment arrives after the lead time. Backlog B05.
2. **Ablations ran on 5 seeds, not 10**; ablations (c) no credit and (f) home depot were dropped. `abl_uniform_service` came out slightly *cheaper* than the engine, so per-SKU service levels did not pay (B07, B08).
3. **The forecaster learns festival uplifts well but monthly seasonality and the heat effect weakly** (beverage heat 0.5 %/°C learned vs 4 configured). Accuracy holds because the weekly level adapts. The simulator and the model share structure, so WAPE flatters the model (PRD risk 10). The Demand analysis page says so (B09).
4. **Solve time** is above the PRD target of 2 s for ambient (B10).
5. **Sources not independently verified:** the FR8 freight-rate fit (assumption A11) and the diesel price. Everything else is labelled `judgment`.
6. **The Gemini path was run live once** (plan, results, a question; figures verified). The Vertex AI path is tested only against a mock, and the pasted key was blocked there until billing is enabled.
7. **The map needs network tiles** (OpenStreetMap) for the background; without them lanes draw on a plain background. The offline rehearsal with the map has not been done (B02).
8. **Chilled freight** shows about ₹8.8 per kg against ₹4.6 ambient; the reefer trip is cheaper than the dry truck because the vehicle is smaller. A user said it "looked the same as ambient" on some screen and never said which one. Show freight per kg on Plan and Dispatch (B04).
9. No web unit tests exist; only typecheck and build run for the web app (B11, B12).

## 7. Gotchas that cost time (all fixed, but they can come back)

- **pydantic enum fields can arrive as plain strings.** Calling `.value` on them broke three engine routes. Use `ForecastMode(x).value`. `tests/test_service.py` calls the engine over HTTP with default bodies to catch this class; the fake-engine tests cannot.
- **Bun loads only the `.env` of its own working directory**, and the task runner can strip variables. `env.ts` reads the root `.env` explicitly (`loadDotEnv`).
- **MapLibre in Vite** needs `maplibregl.setWorkerUrl(workerUrl)` with `…/maplibre-gl-worker.mjs?url`, or the GeoJSON layer fails with "Worker failed to load". Page zoom breaks MapLibre sizing.
- **Windows:** line endings are mixed (files use CRLF in the working copy; git normalises). Long shell heredocs break in Git Bash; write files with an editor tool. Stop the backend with `taskkill /F /T /PID <pid>` so its engine child dies too. `bun add` can take minutes.
- Plant output is fixed, so festival weeks can run short by design (assumption A21).
- Line ids belong to one plan version; the web re-fetches the plan after every distributor response.
- Experiment results are cached on disk by id; delete `data/engine/experiments/<id>` to force a re-run.

## 7a. Definition of done for any change

- `bun run test` passes (about 2 minutes), `bun run typecheck` passes, and for web changes `bun run --cwd apps/dia-web build` passes.
- A contract change updates schema, generated files, fixtures, fake engine and tests together.
- Any new business number is in `config.yaml` with an `assumptions` entry.
- A user-visible change is looked at in the browser (`bun run dev`), in light and dark.
- A line in `docs/Memory.md` (what landed, what is next, open issues). Commit messages say what and why.
- Never force-push `main`. Never commit `data/`, `.env`, `.venv`, `node_modules`, keys or video files.

## 8. Things outside the repo

- Presentation videos (built from scripts in a temp folder, not in git): `Vitaran-pitch.mp4` (12 slides, 3:48, voice-over, real screenshots, business model and future goals), `Vitaran-demo-fast.mp4`, `Vitaran-demo-voiceover.mp4`, `Vitaran-demo.mp4` (older, show the previous UI). The synthetic Windows voice (Zira) was used. Rebuild needs `imageio-ffmpeg` and `Pillow` in a scratch virtual environment; the slide content is in `docs/Demo.md`.
- Saved copies of the two experiment runs are in the build machine's temp folder only. The numbers are in `docs/Demo.md` and `docs/Memory.md`.
- Google Cloud project and key (see Secrets).
