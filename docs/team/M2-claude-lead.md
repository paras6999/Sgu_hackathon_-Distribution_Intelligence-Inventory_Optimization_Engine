# M2 · Claude Code lead — foundation, types, backend, core web, forecast, integration

Tool: **Claude Code**. It reads `CLAUDE.md` (root), which points here. Repo owner and admin.

## Your folders
| Allowed | Path |
|---|---|
| ✅ own | `packages/dia-types/` (schema changes also need M1) · `packages/dia-config/` schema (`config.py`) |
| ✅ own | `apps/dia-backend/` (not `src/ai`) · `apps/dia-web/` core · `apps/dia-fallback-ui/` |
| ✅ own | `engine/dia-engine/src/dia_engine/forecast/` · `baselines/` · `config.py` · `store.py` |
| ✅ backup | `engine/…/data/` and config values (M4) · `AnalyticsPages.tsx` (M3) |
| ✅ own | `docs/`, `.github/ci.yml`, `CODEOWNERS`, root config |
| ❌ don't edit | `optimize/`, `sim/`, `service/`, `cli.py`, build/release files — ask M1 |

## Start of every session
`git switch main && git pull && bun run setup` → read `docs/Memory.md` → `git switch -c m2/<task>`.

## Tasks
| Phase | Task | Done when |
|---|---|---|
| −1 | `m2/rescaffold` (this foundation) | Merged after M1 review; branch protection on; CODEOWNERS filled |
| 0–6 h | `dist.py` (NB/Poisson quantile, partial expectations, ≤ 2% vs Monte Carlo) | `test_dist_functions` passes |
| 0–6 h | `forecast.py`: ADI/CV² classification, AutoETS + TSB, seasonal naive, 12-origin backtest | `test_forecast_contract` passes; WAPE reported |
| 6–12 h | Festival / promo / weather factors; weekly → daily windows; `targets.py` | Forecast for 384 pairs ≤ 30 s refit |
| 6–12 h | Baseline A and B (use M1's `freight.py`) | `test_baselines_contract` passes |
| 6–12 h | Web Plan / Inbox / Dispatch on the real engine | Journey works in `ENGINE_MODE=source` |
| 12–18 h | Merge M3's pages (or build them at hour 15); results screens on real data; review M1's PRs | Every screen loads from cache |
| any | Keep `docs/` and `Memory.md` current; answer contract questions | — |

## Integration duties
- You review every M3 and M4 PR and own the merge order.
- Contract PRs: run `bun run gen:types`, update fixtures, get M1's approval.
- Watch CI on `main`; revert first if it breaks.

## PR checklist
Branch `m2/…` · `bun run test` and `bun run check:types` green · `Memory.md` line · reviewer M1.
