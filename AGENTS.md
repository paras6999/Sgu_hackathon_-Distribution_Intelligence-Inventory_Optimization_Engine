# AGENTS.md — instructions for any AI coding agent

Project: **Vitaran (DIAgent)**, a distribution intelligence and inventory optimisation engine (hackathon PS2). Built solo by @paras6999 with Claude Code.

## Read first, in this order
1. `docs/Memory.md` — current state and open issues.
2. `docs/Phases.md` — what to build next and the drop order.
3. `docs/Rules.md` — boundaries. `docs/Architecture.md` — how parts connect. `docs/PRD.md` — requirements.

## Hard rules
- Python only in `engine/dia-engine`; TypeScript on Bun everywhere else.
- Data shapes come from `packages/dia-types/schema`; never hand-edit generated files (`bun run gen:types`).
- Quantities come only from the optimiser, never from an LLM. Simulated data must be realistic (`docs/Rules.md`).
- Run `bun run test` before pushing. Never force-push `main`.
- No secrets in code, commits or chat. `.env` is git-ignored.

## Commands
```bash
bun run setup        # bun install + uv sync --all-packages
bun run test         # types + backend + engine tests
bun run dev          # backend (starts the engine) + web on :3000
bun run dev:fake     # same, with fixture data and no engine
bun run data         # generate scenario seed01
bun run gen:types    # regenerate TS + Python types from the schema
```

At the end of a task, add 2–3 lines to `docs/Memory.md`.
