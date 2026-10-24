# M3 · Antigravity — analytics pages, map, assumptions, deck

Tool: **Antigravity** (Argon or a Claude model). Add a workspace rule that tells the agent to read `AGENTS.md` first (check Antigravity's settings for where workspace rules live).

Your work is **not on the critical path**: every page already loads its data and shows a placeholder. Small PRs, one page each. M2 takes over any page not merged by hour 15.

## Your folders
| Allowed | Path |
|---|---|
| ✅ own | `apps/dia-web/src/pages/AnalyticsPages.tsx`, plus new files under `apps/dia-web/src/pages/analytics/` |
| ✅ add | chart/map libraries to `apps/dia-web/package.json` — ask M2 first (suggested: `recharts`, `maplibre-gl` + `react-map-gl`, no API keys) |
| ❌ don't edit | `api.ts`, `App.tsx`, `theme.css`, other pages, anything outside `apps/dia-web` |

## Setup
```bash
bun install
bun run --cwd apps/dia-backend dev:fake     # API on :8000 with fixture data
bun run --cwd apps/dia-web dev              # web on :3000
```
Use only `api.*` from `src/api.ts` and the types from `@dia/types`. Colours: CSS variables in `theme.css` (spec: `docs/Design.md`).

## Tasks (in order)
1. **Results** — KPI cards per policy (engine, baseline A, baseline B): mean, 90% CI, delta vs better baseline; neutral/imbalanced toggle; show at least one KPI that gets worse. Data: `results.kpis`.
2. **Assumptions** — table: parameter, value, unit, source (`judgment` highlighted). Data: `/v1/assumptions`.
3. **Frontier & Ablation** — fill rate vs cost-to-serve line per policy (`results.frontier`); waterfall of INR contribution per mechanism (`results.ablation`).
4. **Map** — depots and distributors; arc width ∝ cases, colour = first reason code; click an arc to filter. Data: plan lines + scenario node coordinates.
5. Demo deck + screenshots (hours 18–22).

## PR checklist
Branch `m3/<page>` · `bunx tsc --noEmit -p apps/dia-web` and `bun run --cwd apps/dia-web build` pass · screenshot in the PR · `Memory.md` line · reviewer M2.
