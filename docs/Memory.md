# Memory.md — Progress log

Read this first in any new chat or AI tool. Each PR adds 2–3 lines under its member (what landed, what's next, open issues). Newest first.

## Project status
- **24 Oct 2026, PR `m2/rescaffold`:** repo restructured into a Bun + uv monorepo.
  - Built and tested: shared types (JSON Schema → TS + pydantic, 8 fixtures), engine package with stubs, **generator v0** (realistic, 3.5 s per seed), weather fallback, engine service + CLI, backend (17 `/v1` endpoints, SQLite, fake/source/binary engine modes), web shell (Plan, Inbox, Dispatch work; analytics pages are placeholders), CI (types, engine, backend, web, e2e).
  - Tests: engine 23 pass / 8 skip (unbuilt modules), backend journey 3 pass, types 8 pass, e2e 3 pass.
  - Stubs (`NotImplementedError` → HTTP 501): forecast, dist (except `window`), targets, baselines, optimise stack, simulation, KPIs.
- Previous Python-only skeleton is tagged `v0-python-skeleton`.

## Decisions log
- Monorepo: Python only in `engine/dia-engine`; Bun + TypeScript for backend and web; shared JSON Schema types.
- Database: parquet (engine) + SQLite via `bun:sqlite` (backend). Plans stored as JSON per version.
- Backend: Hono + plain `bun:sqlite` + Ajv (Drizzle and zod-openapi dropped: fewer moving parts, binary-friendly, same schema as the engine).
- 7 public endpoints added to the PRD's 10: health, scenarios, get plan, proposals, inbox, events, assumptions.
- Engine is stateless about plans; the backend owns plan ids and versions.
- Experiments run as a one-shot `dia-engine experiment` process reporting `PROGRESS` lines.
- Releases: `dia-engine` (PyInstaller) + `dia-server` (Bun compile, web embedded), built by M1.
- Forecast: own NumPy ETS/TSB instead of statsforecast (speed for weekly sim refits; no numba in the binary).
- Generator v0 calibration: ~Rs 4.2 cr/yr per distributor, Diwali snacks ×1.57, beverages May/Dec ×2.2, 4.3% historical stockouts, ~7 t ambient per distributor-week, Sunday ×0.61.

## M1 · Kiro lead
- _next: `m1/build-release` (prove both binaries by hour 3), then freight + validator_

## M2 · Claude Code lead
- `m2/forecast`: FR-03 done. Factors learned from history (season, festival uplift, heat/rain), level by vectorised NumPy ETS (simple vs damped, AIC) or TSB, bands from the 12-origin backtest. seed01: WAPE 14.6% (naive 29.3%), bias -0.6%, P10-P90 coverage 79.9%, festival WAPE 15.3%; backtest 6 s, forecast 0.2-0.4 s. statsforecast removed (28 s import, 7.5 s/fit, numba). Caveat: WAPE is flattered because generator and model share structure (PRD risk 10). _next: targets.py_
- `m2/dist`: `forecast/dist.py` done — NB/Poisson window distribution (`window_dist`), `quantile`, `expected_shortfall` (C2), `expected_leftover` (C8); exact, within 2% of mean vs 400k Monte Carlo draws. M1 can build the curves on it. _next: forecast.py_
- `m2/targets` (stacked on `m2/forecast`): FR-04 done. S = mu + z(CR) sigma over R+L (ambient festival pre-build per A26). seed01 CR: lassi 0.45, dahi 0.52, paneer 0.60, flavoured milk 0.68, atta 0.74, snacks/biscuits/beverages 0.89-0.95, personal/home care 0.98. **Judgment:** P(expire) = cover / RSL on arrival, because the exact newsvendor term is ~0 at our cadences and would put chilled above ambient (M1/M4 may revisit). _next: Baseline A_
- Rescaffold PR opened; CODEOWNERS filled with all four usernames. _next: branch protection after first CI run, `dist.py`, forecast_

## M3 · Antigravity
- _next: Results page on fixtures_

## M4 · Data
- _next: fetch real weather; source the SKU catalogue_

## Open issues
- **Chilled freight looks too expensive:** small reefer loads (~340 kg per 2-day cycle) against a ₹10,000 minimum trip make chilled freight ~25–30% of chilled value. Fix with M1/M4: more dairy volume, smaller vehicles, or multi-drop runs (FR-17).
- `climate.yaml` values are approximate normals, labelled as such; replace by fetching real weather.
