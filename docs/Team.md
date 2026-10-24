# Team.md — Solo build

Vitaran was built by **one person, @paras6999, working with Claude Code**, and is being **handed to a team member working in Kiro** (see `docs/Handoff.md` and `docs/Kiro.md`). Direct pushes to `main` stay allowed; CI runs on every push. The earlier four-person split (Kiro, Antigravity and data members) is retired; all of that work is now on this plan. Git history keeps the old per-member guides (`docs/team/`, removed in the solo switch).

## 1. What one person owns

Everything. The module boundaries and contracts stay exactly as they were, because they keep the code testable and let Claude Code work on one part at a time without breaking another:

| Area | Path | State |
|---|---|---|
| Shared types (contract) | `packages/dia-types/` | done |
| Config and assumptions | `packages/dia-config/`, `engine/…/config.py` | done |
| Synthetic data | `engine/…/data/` | generator v0 done |
| Forecast, distributions, targets | `engine/…/forecast/` | done |
| Baselines A and B | `engine/…/baselines/` | done |
| Optimiser, freight, validator, reason codes, pipeline | `engine/…/optimize/` | **to build** |
| Snapshot, simulation, KPIs, experiments | `engine/…/sim/` | **to build** |
| Engine service and CLI | `engine/…/service/`, `cli.py` | done (calls stubs) |
| Backend API and SQLite | `apps/dia-backend/` | done |
| Web: Plan, Inbox, Dispatch | `apps/dia-web/` | done (on fake data) |
| Web: Results, Frontier, Map, Assumptions | `apps/dia-web/src/pages/AnalyticsPages.tsx` | **to build** |
| Release binaries | `engine/dia-engine/build/`, `tools/release/` | optional |
| Optional AI narration | `apps/dia-backend/src/ai/` | optional, off |

## 2. Git workflow (solo)

- **Small or safe changes:** commit straight to `main` and push. CI runs on every push to `main`.
- **Large or risky changes** (the MILP, the simulator): use a branch and a PR so CI runs before it lands, then squash-merge. No review is needed.
- Before every push: `bun run test`. If you changed the schema: `bun run gen:types` and commit the generated files.
- If CI on `main` goes red, fix or revert it before starting the next task.
- Never force-push `main`; GitHub blocks it, and blocks deleting `main`.
- Commit prefixes: `feat:`, `fix:`, `contract:`, `data:`, `docs:`, `build:`.

### GitHub settings for solo work
| Setting | Value |
|---|---|
| Require a pull request | off (direct pushes allowed) |
| Required approvals / code-owner review | off |
| Required status checks | off (CI still runs and shows on every push and PR) |
| Linear history | on (squash or rebase only) |
| Force pushes, deleting `main` | blocked |
| CODEOWNERS | removed |

## 3. Contracts still matter

Even alone, change a contract deliberately: `packages/dia-types/schema/*`, `store.TABLES`, engine function signatures, the `/v1` and engine routes, `KPI_NAMES`, `POLICY_SETTINGS`. Update the fixtures and keep the tests green in the same commit, and prefix the commit with `contract:`.

## 4. Working with Claude Code

- Each session starts by reading `CLAUDE.md`, `AGENTS.md` and `docs/Memory.md`.
- Give one task at a time from `docs/Phases.md`, e.g. "build `optimize/freight.py` and make the validator test pass".
- Each finished task adds 2–3 lines to `docs/Memory.md`.
