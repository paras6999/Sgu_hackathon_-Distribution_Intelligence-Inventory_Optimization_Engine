---
inclusion: always
---
# Tech

- Engine: Python 3.11 in `engine/dia-engine` (uv workspace). PuLP + HiGHS (CBC fallback), statsforecast, scipy, pandas/pyarrow, FastAPI for the internal service. Ships as a PyInstaller `--onedir` binary `dia-engine`.
- Backend: TypeScript on Bun 1.4 + Hono, `bun:sqlite`, Ajv validation. Ships via `bun build --compile` as `dia-server` with the web build embedded.
- Web: Vite + React 18 + TypeScript.
- Contracts: JSON Schema in `packages/dia-types/schema` → generated pydantic (`dia_types`) and TS (`@dia/types`). Never edit generated files; run `bun run gen:types`.
- Config: `packages/dia-config/config.yaml` (every business number, with an `assumptions` entry).
- Rules: `docs/Rules.md` (quantities never from an LLM; realistic simulated data; error mapping 501/422/409).
- Commands: `bun run setup`, `bun run test`, `bun run test:engine`, `bun run dev`, `bun run engine`.
- Vertex AI (`gemini-4-argon`) only in `apps/dia-backend/src/ai/`, behind `AI_ENABLED=false` by default; credentials never committed.
