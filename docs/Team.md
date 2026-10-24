# Team.md — Who does what (team of 4)

Goal: four people (and their AI tools) work in parallel, the parts join without surprises, and nobody pushes to `main`.

Three things make that work:
1. **Frozen contracts.** `packages/dia-types/schema` (data shapes), `store.TABLES` (parquet columns), function signatures in the engine stubs, and the `/v1` routes.
2. **Fakes.** `packages/dia-types/fixtures` + `ENGINE_MODE=fake`. Build against the fake until the real part lands; then change nothing.
3. **CI on every PR.** Generated types up to date, fixtures valid, engine contract + realism tests, backend journey, web build, backend ↔ engine e2e.

## 1. Members

| ID | Name | GitHub | AI tool | Availability | Role | Guide |
|---|---|---|---|---|---|---|
| **M1** | _____ | @AmeyKuradeAK | Kiro (Opus 5.5 / Sonnet 5.5) | Full-time | **Lead for complex work + build/deploy**: optimiser stack, simulation, engine service, both binaries, release CI, Vertex AI | [team/M1-kiro-lead.md](team/M1-kiro-lead.md) |
| **M2** | _____ | @paras6999 | Claude Code | Full-time | **Foundation + integration**: types, backend, core web, forecast, baselines, data backup, docs, reviews | [team/M2-claude-lead.md](team/M2-claude-lead.md) |
| **M3** | _____ | @vinitchougale05 | Antigravity (Argon / Claude) | Low | Analytics pages, map, assumptions page, deck. **Not on the critical path** | [team/M3-web-analytics.md](team/M3-web-analytics.md) |
| **M4** | _____ | @Shanurrr | any | On demand | Realistic synthetic data. **Not on the critical path** (generator v0 already works) | [team/M4-data.md](team/M4-data.md) |

Escalation: complex or blocked work goes to **M1**. Integration, contract questions and anything M3/M4 can't finish go to **M2**.

## 2. Ownership (one owner per file)

| Path | Owner | Reviewer |
|---|---|---|
| `engine/dia-engine/src/dia_engine/optimize/` | M1 | M2 |
| `engine/dia-engine/src/dia_engine/sim/` | M1 | M2 |
| `engine/dia-engine/src/dia_engine/service/`, `cli.py` | M1 | M2 |
| `engine/dia-engine/build/`, `tools/release/`, `.github/workflows/release.yml` | M1 | M2 |
| `apps/dia-backend/src/ai/` | M1 | M2 |
| `engine/dia-engine/src/dia_engine/forecast/`, `baselines/`, `config.py`, `store.py` | M2 | M1 |
| `packages/dia-types/` | M2 | **M1 + M2 for any schema change** |
| `apps/dia-backend/` (except `src/ai/`) | M2 | M1 |
| `apps/dia-web/` core (shell, Plan, Inbox, Dispatch, `api.ts`, `theme.css`) | M2 | M1 |
| `apps/dia-web/src/pages/AnalyticsPages.tsx` (+ new files it imports) | M3 (backup M2) | M2 |
| `engine/dia-engine/src/dia_engine/data/`, `packages/dia-config/*.yaml` values | M4 (backup M2) | M2 |
| `docs/`, `.github/ci.yml`, `CODEOWNERS`, root config | M2 | M1 |

Never edit a file you don't own. Ask the owner, or open a PR they review. `.github/CODEOWNERS` requests the right reviewers automatically; every path lists two owners, because GitHub never lets you approve your own PR.

## 3. Hand-offs

| Producer → consumer | What | Contract | Until it lands |
|---|---|---|---|
| M4/M2 → all | Scenario parquet | `store.TABLES` | Generator v0 already produces it (`bun run data`) |
| M2 → M1 | Forecast, window distributions, targets | `ForecastBundle`, `dist.*`, `Target` | `fixtures/forecast.json`, `fixtures/targets.json` |
| M1 → M2 | Freight + load build for baselines | `optimize.freight.*` | Copy the A11–A13 formula locally |
| M1 → M2 | Validated plan, re-solve | `/plan`, `/resolve` on the engine | `ENGINE_MODE=fake` |
| M1 → M2 | Snapshot | `get_snapshot()` | `fixtures/snapshot.json` |
| M1 → M2/M3 | Experiment results | `results.json` / `ExperimentResults` | `fixtures/results.json` |
| M2 → M3 | Typed API client, theme tokens | `apps/dia-web/src/api.ts`, `theme.css` | Already there |

## 4. Git workflow (PR only)

```bash
git clone https://github.com/paras6999/Sgu_hackathon_-Distribution_Intelligence-Inventory_Optimization_Engine.git
cd Sgu_hackathon_-Distribution_Intelligence-Inventory_Optimization_Engine
bun run setup          # bun install + uv sync --all-packages
bun run test           # everything green (engine modules not built yet are skipped)
```

1. `git switch -c m<N>/<short-task>` (e.g. `m1/milp-skeleton`, `m3/results-page`).
2. Change only your files. Don't change a function signature or schema without §5.
3. `bun run test` locally. Commit with a prefix: `feat:`, `fix:`, `contract:`, `data:`, `docs:`, `build:`.
4. `git push -u origin m<N>/<short-task>` and open a PR into `main` using the template.
5. Wait for green CI + one review from the owner listed in §2. **Squash merge.**
6. Pull `main` at least every 3 hours. Add a line to `docs/Memory.md` in the PR.

**Branch protection on `main`** (repo admin sets it once): Settings → Branches → Add rule for `main`: require a pull request, 1 approval, review from Code Owners, status checks `types`, `engine`, `backend`, `web`, `e2e`; require linear history; block force pushes and deletion; **do not allow bypassing** (applies to admins too). Collaborators: M1 **Maintain** (releases, secrets), M3 and M4 **Write**.

If `main` breaks: revert first (fast-tracked PR), fix after.

## 5. Changing a contract

Contracts: `packages/dia-types/schema/*`, `store.TABLES`, engine function signatures, `/v1` and engine routes, `KPI_NAMES`, `POLICY_SETTINGS`.

| Change | Process |
|---|---|
| Add an optional field with a default | PR titled `contract: …`, run `bun run gen:types`, review by M1 and M2 |
| New definition / table / endpoint | Same, plus a fixture and a test |
| Rename, remove, retype, change a signature | `contract!: …`, approval from every consumer, announce in chat |

## 6. Integration checkpoints

| Hour | Check | Must be true |
|---|---|---|
| **0** | Setup | Everyone ran `bun run setup && bun run test` green; names filled in; branch protection on |
| **3** | First merges | M1: both binaries build (`m1/build-release`) and validator passes on fixtures. M2: `dist.*` done; web running on real backend |
| **6** | Real data flows | Forecast runs on seed01; `solve()` returns a plan the validator accepts |
| **9** | Pipeline joined | `POST /v1/plans` returns a real validated plan with reason codes; simulator runs a week |
| **12** | **PRD gate** | One seed × 84 days: 0 violations, 0 conservation failures, every line coded; smoke run; targets frozen |
| **15** | Demo tier | Inbox trim runs the real locked re-solve; full experiment running |
| **18** | **Freeze** | Every screen loads from cache running the **release binaries** |

## 7. If someone falls behind

Apply the PRD drop order (§5.1) first. Then move whole files, never share one: M2 takes M3's pages or M4's data work; M1 can hand `sim/kpi.py` to M2. Write the new owner in §2 and `Memory.md`.
