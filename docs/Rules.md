# Rules.md — Boundaries for the AI tools

Read with `PRD.md` (what), `Architecture.md` (how it connects), `Phases.md` (what next) and `Team.md` (solo workflow).

## Scope
- `PRD.md` is the source of truth. If code and PRD disagree, flag it; don't silently deviate.
- Build in the order in `Phases.md`. P1/P2 features wait until the hour-18 freeze.
- Never cut: the validator, the conservation assertion, both baselines, reason codes, both opening states.

## Languages and boundaries
- **Python only in `engine/dia-engine`** (plus the emergency Streamlit app). Everything else is TypeScript on Bun.
- The web app calls the `/v1` API only. The backend calls the engine only through `EngineClient`. Nobody imports across these lines.
- The engine service and the simulator call `make_plan()`. Nobody else calls `optimize`, `explain` or `validate`.
- Only `dia_engine/store.py` touches parquet; only `apps/dia-backend/src/db/repo.ts` touches SQLite. The engine never writes SQLite.

## Contracts
- Data shapes live in `packages/dia-types/schema/*.schema.json`. Never edit `dist/`, `ts/generated.ts` or `py/dia_types/models.py` by hand; run `bun run gen:types`.
- Don't change a schema definition, `store.TABLES`, an engine function signature or a route without a deliberate `contract:` commit that also updates fixtures and tests (`Team.md` §3).
- Exchange data only through dia-types models (or `store.TABLES` parquet). No ad hoc dicts across modules.

## Libraries
- Use the stack in `Architecture.md` §3. Ask before adding a dependency (both `package.json` and `pyproject.toml`).
- No ORMs, database servers, cloud services or paid APIs. SQLite and parquet only.

## Data and parameters
- Every business number comes from `packages/dia-config/config.yaml` with an `assumptions` entry (unit and source, or `judgment`).
- The forecaster reads `demand_daily` only for dates before `as_of`.
- Units: INR, cases, kg, m³, days. Put the unit in the name when unclear (`cost_inr`, `storage_m3`).
- No real brand names; never invent a citation.

## Simulated data must be realistic, not random
The data is simulated, but judges will test whether it is believable. Every generated number needs a real basis.
- **Anchor to real sources:** Open-Meteo weather per city (climatology fallback is labelled approximate); real festival dates by region; freight fitted to FR8 market rates and the current diesel price; real city coordinates and Census populations.
- **Realistic SKU economics:** Indian FMCG pack sizes, MRPs, margins, case weights/volumes and shelf lives (dairy 10–21 days, snacks 3–6 months, detergents 18–36 months). Price > landed cost > 0.
- **Realistic demand structure:** city size, weekday pattern (quiet Sundays), monthly seasonality, festival uplift by region and category, weather effects, unannounced promos with post-promo dips.
- **Randomness only as calibrated noise:** negative binomial around a realistic mean. No uniform random draws for business quantities.
- **Sanity checks in `tests/test_realism.py`:** turnover per distributor, festival uplift, summer beverages, stockout rate, truck-scale loads, quiet Sundays, SKU economics, determinism. A failing check is a generator or config bug.

## AI usage in the product
- Quantities come only from the optimiser or a baseline. Never from an LLM.
- Optional narration/Q&A (FR-25) lives in `apps/dia-backend/src/ai/`, behind `AI_ENABLED` (default `false`), with a non-AI fallback so the demo works offline.
- Vertex AI credentials stay in a local `.env` or GitHub secret. Never in code, logs, issues or chat.

## Determinism
- Seed everything. Same config + seed ⇒ same parquet tables and KPI hash.
- Within a seed, every policy sees identical demand, delay and promo draws. Solver single-threaded in experiments.

## Error handling
- Config errors fail fast with the field name (pydantic, `extra="forbid"`).
- Unfinished function: `raise NotImplementedError("M<N>: FR-nn")` → engine 501 → backend 501.
- Solver failure: `optimize.SolverFailed` → Baseline B fallback, `solve.status = fallback_baseline_b`.
- Solver timeout (30 s): incumbent if gap ≤ 5%, else round-and-repair the LP relaxation; set `solve.status`.
- Validator violation: `PlanInvalid` → engine 422 → backend 500. Never return an unvalidated plan.
- Stale proposal version: 409. Bad line or trim quantity: 422.
- Weather API failure: use the cache or the climatology fallback; never call it during experiments or the demo.

## Git
- Solo workflow (`Team.md` §2): small changes straight to `main`; large or risky ones on a branch + PR, squash-merged after CI. Run `bun run test` before every push. Never force-push.
- Never commit `data/`, `.venv/`, `node_modules/`, `.env`, credentials, LP dumps or build outputs.
- Add a line to `docs/Memory.md` for every finished task.

## Code style
- Python 3.11, type hints, small pure functions, no global mutable state in the engine. TypeScript `strict`.
- Each module starts with a docstring naming its owner and PRD requirement.
- Match the surrounding code's naming and comment density.
