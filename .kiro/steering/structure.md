---
inclusion: always
---
# Structure and boundaries

```
apps/dia-web      React UI. Calls only /v1.            pages/ components/ theme.css api.ts
apps/dia-backend  Bun API, SQLite app state.            src/app.ts (routes) engine/ (EngineClient) ai/ db/ openapi.ts
engine/dia-engine Python engine, parquet data.          data/ forecast/ optimize/ baselines/ sim/ service/
packages/dia-types   JSON Schema → TS + Python types, fixtures
packages/dia-config  config.yaml (every business number), climate.yaml
docs/             Handoff.md, Kiro.md, Backlog.md, PRD.md, Architecture.md, Rules.md, Design.md, Demo.md, Memory.md
```

Boundaries (do not cross):
- Web → backend `/v1` only. Backend → engine only through `EngineClient` (`engine/client.ts`; `http.ts`, `fake.ts`). No cross imports.
- Only `engine/.../store.py` touches parquet; only `apps/dia-backend/src/db/repo.ts` touches SQLite. The engine never writes SQLite.
- Planning goes through `optimize/pipeline.make_plan` (forecast → targets → optimise → explain → validate). Nothing else calls `optimize`, `explain` or `validate`.
- One freight implementation: `optimize/freight.py`. Baselines and the engine both use it.
- Contract changes (schema, `store.TABLES`, route or function signatures) update fixtures, the fake engine and tests in the same commit.
- Tests: engine `engine/dia-engine/tests/`, backend `apps/dia-backend/test/`, types `packages/dia-types`. Engine tests that need data use the `seed01` fixture in `conftest.py` and set `DIA_DATA_DIR`.
