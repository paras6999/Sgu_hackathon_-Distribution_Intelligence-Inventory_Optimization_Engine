# Vitaran (DIAgent) — Distribution Intelligence & Inventory Optimization Engine

Hackathon Problem Statement 2. One network-wide decision per planning cycle: forecast → targets → mixed-integer allocation (depot, lot, quantity, truck) → reason codes → distributor confirmation → simulated proof against two baselines.

```
apps/dia-web (React) ──/v1──▶ apps/dia-backend (Bun + Hono, SQLite) ──▶ engine/dia-engine (Python, parquet)
                         packages/dia-types: one JSON Schema → TS + Python types
```

## Read in this order
| File | What |
|---|---|
| [docs/Handoff.md](docs/Handoff.md) | **Start here when taking over**: state, run steps, architecture, gaps, gotchas |
| [docs/Kiro.md](docs/Kiro.md) | Working in Kiro: Opus 5.5 plans, Haiku 5.5 implements; prompts and templates |
| [docs/Kiro-first-prompt.md](docs/Kiro-first-prompt.md) | Run 0: the first prompt for Opus, gathers evidence into `docs/Ground-truth.md` |
| [docs/Backlog.md](docs/Backlog.md) | What to do next (B01 to B19), sized for small tasks |
| [AGENTS.md](AGENTS.md) | Rules and commands for AI agents |
| [docs/Team.md](docs/Team.md) | Ownership, git workflow, GitHub settings |
| [docs/Architecture.md](docs/Architecture.md) | Languages, folders, database, APIs, contracts |
| [docs/PRD.md](docs/PRD.md) | Requirements |
| [docs/Phases.md](docs/Phases.md) | Solo build plan and drop order |
| [docs/Rules.md](docs/Rules.md) | Boundaries, realism rules, AI rules |
| [docs/Design.md](docs/Design.md) | Screens, colours, fonts |
| [docs/Demo.md](docs/Demo.md) | Demo script, results of record, judge Q&A |
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

Open http://localhost:3000 (planner app) or http://localhost:3002 (warehouse app for depot and distributor staff, phone-first; see docs/Warehouse-app.md). `bun run dev` starts the backend on :8000, which starts the engine on :7010. Use `bun run dev:fake` to run on fixture data without the engine. API docs: http://localhost:8000/docs.

Solo workflow: small changes go straight to `main`, larger ones through a PR so CI runs first (`docs/Team.md` §2).
