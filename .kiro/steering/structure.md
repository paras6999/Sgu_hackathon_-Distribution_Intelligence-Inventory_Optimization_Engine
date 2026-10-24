---
inclusion: always
---
# Structure

See `docs/Architecture.md` §2 for the full tree. M1 owns:
- `engine/dia-engine/src/dia_engine/optimize/` — optimize.py, freight.py, validate.py (independent of optimize), explain.py, pipeline.py
- `engine/dia-engine/src/dia_engine/sim/` — simulate.py, kpi.py, policy.py
- `engine/dia-engine/src/dia_engine/service/` and `cli.py`
- `engine/dia-engine/build/`, `tools/release/`, `.github/workflows/release.yml`
- `apps/dia-backend/src/ai/`

Contract tests: `engine/dia-engine/tests/test_contracts.py` (skipped until a module is implemented, then must pass). E2E: `E2E=1 bun test apps/dia-backend/test/e2e.test.ts`.
