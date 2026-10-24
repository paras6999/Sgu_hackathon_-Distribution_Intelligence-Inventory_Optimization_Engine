# Rules.md — Boundaries for the AI

## Do
- Treat PRD.md as the source of truth. If code and PRD disagree, ask or flag it; do not silently deviate.
- Read business parameters only from `config/config.yaml`. Each parameter carries a unit and a source or a "judgment" flag.
- Build in the order in Phases.md. Do not start a later phase before the earlier gate passes.
- Keep the engine deterministic: seed everything, use common random numbers across policies, run the solver single-threaded in experiments.
- Share pydantic v2 models between engine and API.
- Write a test for every reason code, the validator, stock conservation, and the waste and lost-sales curves.
- Update Memory.md at the end of every working session once coding starts.

## Do not
- Add libraries beyond the stack in Architecture.md without asking.
- Hardcode business numbers (costs, margins, shelf lives, capacities) in engine modules.
- Call live APIs (weather, etc.) during experiments or demo; use the cached parquet.
- Let an LLM or any model output quantities. Quantities come only from the optimiser.
- Use real brand names or fabricate sources. Mark unsourced values "judgment".
- Build P1/P2 features before the P0 hour-18 freeze.

## Never cut
Validator, conservation assertion, both baselines, reason codes, both opening states.

## Error handling
- Config errors: fail fast with the offending field name (pydantic).
- Solver infeasible: dump the LP, fall back to Baseline B for that cycle, flag in UI.
- Solver timeout (30 s): use the incumbent if gap <= 5%, else round and repair the LP relaxation; flag the plan.
- HiGHS unavailable: use CBC.
- Stale proposal version: HTTP 409. Never mutate another distributor's lines.
- Weather fetch failure: use cache; never block the app.

## Code style
- Python 3.11, type hints, small pure functions, no global state in engine.
- Money in INR, quantities in cases, volume in m3, weight in kg. Name units in variables where unclear.
- Match the existing code's naming and comment density.
