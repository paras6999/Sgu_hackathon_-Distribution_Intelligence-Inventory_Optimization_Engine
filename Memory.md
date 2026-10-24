# Memory.md — Progress log

Read this first in any new chat or AI tool. Update your section at the end of every working session (2–3 lines: what landed, what's next, open issues). Newest entries on top within each section.

## Project status
- Hour 0 (24 Oct 2026): docs (`PRD`, `Architecture`, `Rules`, `Phases`, `Design`, `Team`) and the code skeleton are on `main`.
- Implemented: `engine/models.py` (all contracts), `engine/config.py`, `engine/store.py` (parquet + SQLite), `engine/fakes.py`, `engine/pipeline.py` glue, `api/main.py` (17 endpoints), `api/backend.py` (fake/real switch), Streamlit shell, CI.
- Stubs (`NotImplementedError`): everything else in `engine/`. Contract tests: 9 pass, 9 skipped until owners implement.
- Run on fakes now: `VITARAN_FAKE=1 uvicorn api.main:app --reload` and `streamlit run app/streamlit_app.py`.

## Decisions log
- Database: parquet for analytical tables, SQLite for app state; no DB server (Architecture.md §4).
- Plan lines stored as JSON inside `plans.payload` instead of a `plan_lines` table.
- 7 API endpoints added to the PRD's 10: health, scenarios, get plan, proposals, inbox, events, assumptions.
- Baseline A owned by B, Baseline B owned by A (separate files, no shared ownership).

## Member A · Data & Simulation
- _not started_

## Member B · Forecasting & Targets
- _not started_

## Member C · Optimisation & Explanations
- _not started_

## Member D · API, Database & UI
- _not started_

## Open issues
- _none_
