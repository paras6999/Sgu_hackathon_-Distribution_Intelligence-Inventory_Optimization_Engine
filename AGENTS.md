# AGENTS.md — instructions for any AI coding agent (Antigravity, Kiro, Claude Code, others)

Project: **Vitaran (DIAgent)**, a distribution intelligence and inventory optimisation engine (hackathon PS2).

## Read first, in this order
1. `docs/Memory.md` — current state and open issues.
2. Your member guide in `docs/team/`: M1 Kiro lead · M2 Claude Code lead · M3 web analytics · M4 data. Ask the user which member they are if unsure.
3. `docs/Rules.md` — boundaries. `docs/Architecture.md` — how parts connect. `docs/PRD.md` — requirements.

## Hard rules
- Never push to `main`. Work on `m<N>/<task>`, open a PR (`docs/Team.md` §4).
- Edit only files your member owns (`docs/Team.md` §2).
- Python only in `engine/dia-engine`; TypeScript on Bun everywhere else.
- Data shapes come from `packages/dia-types/schema`; never hand-edit generated files (`bun run gen:types`).
- Quantities come only from the optimiser, never from an LLM. Simulated data must be realistic (`docs/Rules.md`).
- No secrets in code, PRs or chat. `.env` is git-ignored.

## Commands
```bash
bun run setup        # bun install + uv sync --all-packages
bun run test         # types + backend + engine tests
bun run dev          # backend (starts the engine) + web on :3000
bun run dev:fake     # same, with fixture data and no engine
bun run data         # generate scenario seed01
bun run gen:types    # regenerate TS + Python types from the schema
```

At the end of a session, add 2–3 lines under your member in `docs/Memory.md`.
