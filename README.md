# Vitaran (DIAgent) — Distribution Intelligence & Inventory Optimization Engine

Hackathon Problem Statement 2. One network-wide decision per planning cycle: forecast → targets → mixed-integer allocation (depot, lot, quantity, truck) → reason codes → distributor confirmation → simulated proof against two baselines.

```
apps/dia-web (React) ──/v1──▶ apps/dia-backend (Bun + Hono, SQLite) ──▶ engine/dia-engine (Python, parquet)
                         packages/dia-types: one JSON Schema → TS + Python types
```

## Read in this order
| File | What |
|---|---|
| [AGENTS.md](AGENTS.md) | Rules and commands for AI agents |
| [docs/Team.md](docs/Team.md) | Solo build: what's done, what's left, git workflow, GitHub settings |
| [docs/Architecture.md](docs/Architecture.md) | Languages, folders, database, APIs, contracts |
| [docs/PRD.md](docs/PRD.md) | Requirements |
| [docs/Phases.md](docs/Phases.md) | Solo build plan and drop order |
| [docs/Rules.md](docs/Rules.md) | Boundaries, realism rules, AI rules |
| [docs/Design.md](docs/Design.md) | Screens, colours, fonts |
| [docs/Memory.md](docs/Memory.md) | Progress log; update every PR |

## Quick start
Needs [Bun 1.4](https://bun.sh) and [uv](https://docs.astral.sh/uv/).

```bash
bun run setup
```
```bash
bun run test
```
```bash
bun run data
```
```bash
bun run dev
```

Open http://localhost:3000. `bun run dev` starts the backend on :8000, which starts the engine on :7010. Use `bun run dev:fake` to run on fixture data without the engine. API docs: http://localhost:8000/docs.

Solo workflow: small changes go straight to `main`, larger ones through a PR so CI runs first (`docs/Team.md` §2).
