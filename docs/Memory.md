# Memory.md — Progress log

Read this first in any new chat or AI tool. Add 2–3 lines per finished task (what landed, what's next, open issues). Newest first.

## Project status
- **24 Oct 2026, switched to a solo build** (@paras6999 + Claude Code). Docs rewritten for one person; GitHub now allows direct pushes to `main` (no PR, review or required checks; CI still runs; force-push and deletion blocked; linear history). CODEOWNERS, per-member guides and Kiro steering removed.
- **Merged on `main`:** rescaffold (#1), CODEOWNERS (#2, later removed), forecast (#4), dist (#5), targets (#3), Baseline A (#6), Baseline B (#7).
- **Built and tested:** shared types (JSON Schema → TS + pydantic), generator v0, weather fallback, forecast, window distributions, targets, Baselines A and B, engine service + CLI, backend (17 `/v1` endpoints, SQLite, fake/source/binary modes), web Plan/Inbox/Dispatch, CI (types, engine, backend, web, e2e).
- **Still stubs** (`NotImplementedError` → HTTP 501): `optimize/` (optimize, freight, validate, explain, pipeline re-solve), `sim/` (snapshot, simulation, KPIs, experiments). Next: `docs/Phases.md` Phase 1.
- Previous Python-only skeleton is tagged `v0-python-skeleton`.

## Log
- **Solo switch:** docs and GitHub settings changed for one person. _next: Phase 1 step 1, `optimize/freight.py`._
- **Baseline B (#7):** (s, S) at 95% on the engine forecast (s = lead-time demand, S = R+L demand), seeded FCFS, nearest depot with usable stock, FEFO; lanes ≥ 70% of the last truck topped up with highest-velocity SKUs (capped at one review period, within storage/credit); < 70% go PTL. `build_plan` has a lane-mode hook.
- **Baseline A (#6):** proportional split by forecast demand within the home region, capped at cover; FIFO; MRSL; pro-rata storage/credit cuts; cheaper of FTL/PTL. Shared helpers in `baselines/common.py` (freight is a local A11–A13 copy until `optimize/freight.py` exists).
- **Targets (#3):** S = μ + z(CR)σ over R+L (ambient festival pre-build per A26). seed01 CR: lassi 0.45, dahi 0.52, paneer 0.60, flavoured milk 0.68, atta 0.74, snacks/biscuits/beverages 0.89–0.95, personal/home care 0.98. Judgment: P(expire) = cover / RSL on arrival (the exact newsvendor term is ~0 at our cadences and would put chilled above ambient).
- **Dist (#5):** NB/Poisson window distribution, quantile, E[(D−z)+] (C2), E[(q−D)+] (C8); exact, within 2% of mean vs Monte Carlo.
- **Forecast (#4):** factors learned from history (season, festival uplift, heat/rain); level by NumPy ETS (simple vs damped, AIC) or TSB; bands from the 12-origin backtest. seed01: WAPE 14.6% (naive 29.3%), bias −0.6%, coverage 79.9%, festival WAPE 15.3%; backtest 6 s, forecast 0.2–0.4 s. WAPE is flattered because generator and model share structure (PRD risk 10).

## Decisions log
- Monorepo: Python only in `engine/dia-engine`; Bun + TypeScript for backend and web; shared JSON Schema types.
- Database: parquet (engine) + SQLite via `bun:sqlite` (backend). Plans stored as JSON per version.
- Backend: Hono + plain `bun:sqlite` + Ajv (Drizzle and zod-openapi dropped: fewer moving parts, binary-friendly, same schema as the engine).
- 7 public endpoints added to the PRD's 10: health, scenarios, get plan, proposals, inbox, events, assumptions.
- Engine is stateless about plans; the backend owns plan ids and versions.
- Experiments run as a one-shot `dia-engine experiment` process reporting `PROGRESS` lines.
- Releases (optional): `dia-engine` (PyInstaller) + `dia-server` (Bun compile, web embedded).
- Forecast: own NumPy ETS/TSB instead of statsforecast (speed for weekly sim refits; no numba in the binary).
- Generator v0 calibration: ~₹4.2 cr/yr per distributor, Diwali snacks ×1.57, beverages May/Dec ×2.2, 4.3% historical stockouts, ~7 t ambient per distributor-week, Sunday ×0.61.

## Open issues
- **Chilled freight looks too expensive:** small reefer loads (~340 kg per 2-day cycle) against a ₹10,000 minimum trip make chilled freight ~25–30% of chilled value. Decide while building the optimiser: more dairy volume, smaller vehicles, or multi-drop runs (FR-17).
- Baseline A weights use forecast demand because snapshots carry no trailing sales.
- `climate.yaml` values are approximate normals, labelled as such; replace by fetching real weather (`dia-engine weather --fetch`).
- Module docstrings and `NotImplementedError` messages still name the old owners (M1–M4); harmless, update as each module is built.
