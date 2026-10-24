# M1 · Kiro lead — optimiser, simulation, engine service, builds and releases (@AmeyKuradeAK)

Tool: **Kiro** (Opus 5.5 for the MILP and simulation, Sonnet 5.5 for routine edits). Kiro reads `.kiro/steering/*.md`, which point here.

## Your folders
| Allowed | Path |
|---|---|
| ✅ own | `engine/dia-engine/src/dia_engine/optimize/` · `sim/` · `service/` · `cli.py` |
| ✅ own | `engine/dia-engine/build/` · `tools/release/` · `.github/workflows/release.yml` |
| ✅ own | `apps/dia-backend/src/ai/` (Vertex AI, optional) |
| 👀 review | everything under `engine/`, every `contract:` PR in `packages/dia-types/schema/` |
| ❌ don't edit | `forecast/`, `baselines/`, `apps/dia-backend` (except `src/ai`), `apps/dia-web`, generated types — ask M2 |

## Start of every session
1. `git switch main && git pull && bun run setup`
2. Read `docs/Memory.md`, then this file, then the PRD section for today's task.
3. `git switch -c m1/<task>`

## Tasks
| Phase | Task | Done when |
|---|---|---|
| 0–3 h | **`m1/build-release`**: PyInstaller `--onedir` spec for `dia-engine` (bundle `packages/dia-config` as `dia-config`); `bun build --compile` for `dia-server` with `apps/dia-web/dist` embedded and served; `release.yml` matrix (windows, ubuntu, macos) on tags `v*` attaching zips to a GitHub Release | `ENGINE_MODE=binary` backend + both binaries serve the web app and pass `/v1/health` on all 3 OS |
| 0–6 h | `freight.py` (A11–A13, festival premium), `validate.py` (independent; never import optimize) | `test_validator_accepts_fixture_plan` and `…catches_overshipment` pass |
| 0–6 h | `optimize.py` skeleton: lots, arcs (MRSL filter, 3 candidate depots), integer FTL trips, PTL with min charge, C2 lost-sales curve | `test_optimizer_output_is_valid` passes on fixtures |
| 6–12 h | C8 waste curves, MRSL cliff, credit, storage, `build_loads`, `explain.py` (11 codes), `make_plan` | `POST /v1/plans` returns a real plan, every line coded; p95 ambient solve ≤ 2 s |
| 6–12 h | `get_snapshot` (neutral + imbalanced), simulation loop, credit cuts, conservation assert, `kpi.py` | Hour-12 gate (Phases.md) |
| 12–18 h | `locks_for_response` + `apply_response` (C10, add-only for unresponded); counterfactual reason-code test; `run_experiment` (20 seeds × 2 states, multiprocessing) | Inbox trim does a real re-solve; experiment ≤ 25 min; release v0.1 |
| 18–22 h | FR-13 carbon, FR-17 milk runs; optional AI narration | Demo runs from release binaries |

## Build and deploy rules
- Demo = **local release binaries**, network off. A hosted URL is optional and only after the hour-18 freeze.
- PyInstaller can't cross-compile: build `dia-engine` on each OS in CI. Bun can cross-compile `dia-server`.
- statsforecast uses numba: if bundling fails by hour 3, tell M2 so forecast switches to hand-written ETS/TSB.
- Binary paths: the backend finds the engine via `ENGINE_BIN`; config via `DIA_CONFIG_DIR` or `sys._MEIPASS/dia-config` (already handled in `config.py`).

## Vertex AI (you hold the access)
- `gemini-4-argon` only for narration / Q&A in `apps/dia-backend/src/ai/`; never for quantities.
- Credentials via `gcloud auth application-default login` or a service-account file in `.env` (git-ignored). For CI use a GitHub Actions secret. Never paste keys in chat, code or PRs.
- `AI_ENABLED=false` must keep everything working.

## PR checklist
Branch `m1/…` · only your folders · `bun run test` green · validator 0 violations on fixtures and seed01 · `Memory.md` line · reviewer M2.
