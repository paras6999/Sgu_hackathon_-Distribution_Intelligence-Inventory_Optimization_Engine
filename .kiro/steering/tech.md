---
inclusion: always
---
# Tech

- **Python only in `engine/dia-engine`** (FastAPI, NumPy/pandas/SciPy, PuLP + HiGHS, parquet). **TypeScript on Bun everywhere else**: backend Hono + `bun:sqlite` + Ajv; web React 18 + Vite + `maplibre-gl`. No ORMs, no servers, no paid services. Ask before adding any dependency.
- Package managers: `bun` and `uv`. Ports: web 3000, backend 8000, engine 7010.
- Shared data shapes: `packages/dia-types/schema/*.schema.json` → `bun run gen:types` → TypeScript and pydantic. Never edit generated files.
- Commands: `bun run setup`, `bun run test` (about 2 min), `bun run typecheck`, `bun run dev`, `bun run dev:fake`, `bun run gen:types`. Web build: `bun run --cwd apps/dia-web build`.
- Style: match the surrounding code (comment density, naming). Units in names (`cost_inr`, `storage_m3`). Seeds everything; same config and seed give the same tables. Web styling uses the tokens and classes in `apps/dia-web/src/theme.css`, no raw hex and no new inline layout styles.
- Pitfall list (read before debugging): `docs/Handoff.md` §7. The two that bite most: pydantic enum fields arrive as strings, so use `ForecastMode(x).value`, never `x.value`; Bun does not load the root `.env`, `apps/dia-backend/src/env.ts` does.
- Secrets: `.env` is git-ignored. Never print, log, paste or commit a key.
