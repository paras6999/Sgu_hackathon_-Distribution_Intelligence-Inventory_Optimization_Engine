# Rules.md — Boundaries for the AI (and the team)

Read with `PRD.md` (what), `Architecture.md` (how it connects) and `Team.md` (who owns what).

## Scope
- `PRD.md` is the source of truth. If code and PRD disagree, flag it; do not silently deviate.
- Build in the order in `Phases.md`. P1/P2 features wait until the hour-18 freeze.
- Never cut: the validator, the conservation assertion, both baselines, reason codes, both opening states.

## Contracts and ownership
- Only edit files owned by the member you are helping (`Team.md` §1). Ask before touching another member's file.
- Never change a function signature in an `engine/*.py` stub, a model in `engine/models.py`, a table in `store.TABLES` or an API path without a contract-change PR (`Team.md` §4).
- When you add a field to a model, also update `engine/fakes.py` and keep `tests/test_contracts.py` green.
- Exchange data only through the models in `engine/models.py`. No passing raw dicts or DataFrames between members' modules (except the parquet tables via `store`).
- Only `engine/store.py` reads or writes files and the database. Engine modules never write SQLite.
- The API and the simulator call `engine.pipeline.make_plan()`. Nobody else calls `optimize`, `explain` or `validate` directly.
- The Streamlit app calls the HTTP API only; it never imports `engine` modules.

## Libraries
- Use only the stack in `Architecture.md` §3 / `requirements.txt`. Ask before adding a dependency.
- No ORMs, no database servers, no cloud services. SQLite and parquet only.

## Data and parameters
- Every business number (costs, margins, shelf lives, capacities, penalties) comes from `config/config.yaml` and has an `assumptions` entry with unit and source or `judgment`.
- The forecaster reads `demand_daily` only for dates before `as_of`. Reading the future is a bug.
- Units: INR, cases, kg, m³, days. Put the unit in the name when unclear (`cost_inr`, `storage_m3`).
- No real brand names; mark unsourced values `judgment`; never invent a citation.
- Quantities come only from the optimiser (or a baseline). Never from an LLM.

## Simulated data must be realistic, not random
The data is simulated, but judges will test whether it is believable. Every generated number needs a real basis.
- **Anchor to real sources:** Open-Meteo weather for each city; actual festival dates by region (Diwali 12 Nov 2023, 1 Nov 2024, 20 Oct 2025; Durga Puja, Pongal, Onam, etc.); freight fitted to FR8 market rates and the current diesel price; real city coordinates.
- **Realistic SKU economics:** prices, margins, case weights and volumes, and shelf lives typical of Indian FMCG (dairy 10–21 days, snacks 3–6 months, detergents 18–36 months). Margins and costs consistent with each other (price > landed cost > 0).
- **Realistic demand structure:** base demand scaled by city size and region, weekday pattern (weekend peaks for GT), monthly seasonality (summer beverages and dairy, monsoon dip in footfall), festival uplift by category and region, promo uplift with a post-promo dip.
- **Randomness only as calibrated noise:** negative-binomial noise around a realistic mean, with dispersion set so the coefficient of variation is plausible at SKU × distributor × day level. No uniform random draws for business quantities.
- **Sanity checks in tests:** total network sales, festival uplift, freight as % of revenue (about 2–3%), expiry rate (about 0.5–2% of value), stockout rate and distributor stock cover all fall within the ranges in `PRD.md` §2.3 and §8.2. A failing check is a generator bug.
- Every generator parameter lives in `config.yaml` with a source or a `judgment` tag and a one-line rationale.

## Determinism
- Seed everything. Same config + seed ⇒ same parquet hash and same KPI hash.
- Common random numbers: within a seed, every policy sees identical demand, delay and promo draws.
- Solver single-threaded in experiments.

## Error handling
- Config errors: fail fast with the offending field name (pydantic).
- Unfinished function: `raise NotImplementedError("Member X: FR-nn")`; the API maps it to HTTP 501.
- Solver infeasible or failed: raise `optimize.SolverFailed`; the pipeline falls back to Baseline B and flags `solve.status`.
- Solver timeout (30 s): return the incumbent if gap ≤ 5%, else round and repair the LP relaxation; set `solve.status`.
- HiGHS missing: use CBC.
- Validator violation: raise `pipeline.PlanInvalid`; never return an unvalidated plan.
- Stale proposal version: HTTP 409. Bad line id or trim quantity: HTTP 422.
- Weather API failure: use the cache; never call it during experiments or the demo.

## Git
- Branch per task with your letter prefix (`a/…`, `b/…`, `c/…`, `d/…`); PR into `main`; CI green plus one consumer review; squash merge.
- Never commit `data/`, `.venv/`, secrets or LP dumps.
- Update `Memory.md` at the end of each working session.

## Code style
- Python 3.11, type hints, small pure functions, no global mutable state in `engine/`.
- Docstring at the top of each module naming its owner and PRD requirement.
- Match the surrounding code's naming and comment density.
