# Frontend pages plan: Demand, Results, Map, Frontier & Ablation, Stock watch

Target app: `apps/dia-next` (Next.js 16, React 19, App Router). The old `apps/dia-web` stays untouched and is used only to read logic from. Its style is NOT copied: dia-next is a Salesforce-like record-page style (white `.record` panels, `.strip` metric rows, `.tabs`, `.box`, `.table-wrap`, `.chip`, `.status` pills), dia-web is a card dashboard.

How agents use this file: each agent gets one task section (plus sections 0 and 7) as its job. Tasks are written so a small model can build them without asking questions. Anything not written here is out of scope.

---

## 0. Rules for every agent

- Repo root: `c:\Dev-Drive\sgu-hack\Sgu_hackathon_-Distribution_Intelligence-Inventory_Optimization_Engine`. Shell is PowerShell: use `;`, not `&&`.
- Edit ONLY the files listed as owned by your task (section 6). Never edit `packages/dia-types` (types are generated and already contain what you need), `apps/dia-web`, `engine/`, `.env*`, or the root `package.json`. Do not run `bun add` or `npm install`: dependencies are added in step 0.
- Do not git add, commit, push or switch branches. Do not open any `.env` file. Do not start servers except where a task says so, and stop them after.
- No new test files. No long testing. Run only the checks named in your task.
- Look: follow the existing dia-next look. Tokens are the CSS variables in `src/app/globals.css` (`--bg --panel --text --muted --line --brand --brand-ink --ok --ok-soft --warn --warn-soft --bad --bad-soft --soft`). Page-specific styles go in a CSS Module next to the component (`Name.module.css`). Reuse existing global classes by name (`record`, `strip`, `tabs`, `box`, `table-wrap`, `chip`, `status`, `btn`, `notice`, `empty`, `seg-btn`). Do not append to `globals.css` (only task B may).
- Words: plain English for a supply planner. Use the names in section 7. Never show WAPE, MRSL, FTL, PTL, P10, P90, ablation, baseline A/B, "CI" on screen.
- Numbers come only from the API. Never hard-code a result number. Use `formatRupees`, `formatNumber`, `formatPercent`, `formatDate` from `src/lib/format.ts`.
- Every page root is `<section className="record" data-page="<name>" data-ready={loaded ? "true" : "false"}>`. `data-ready` becomes `"true"` when the page's data has arrived (used for screenshots).
- Each page calls `usePageContext({...})` (task B) and `useUiActions(handler)` (task B) so the assistant knows what is on screen and can change filters.
- Charts are hand-written SVG (no chart library). Use `src/lib/chart.ts` helpers (task B). Every chart has: axis labels in words, a legend, a one-sentence caption under it, `<title>` tooltips on points.
- Done check for frontend tasks: `bun run --cwd apps/dia-next typecheck`, `bun run --cwd apps/dia-next lint`, `bun run --cwd apps/dia-next build` all pass. Report: files created, the three results, deviations.

---

## 1. Step 0 (orchestrator, before any agent starts)

1. Contract (additive), in `packages/dia-types/schema/assistant.schema.json`, then `bun run gen:types`:
   - `AssistantRequest`: `plan_id` becomes optional; add `page` (enum `planning|demand|results|frontier|map|stock`, default `planning`); add `context` (object, all fields optional): `experiment_id`, `opening_state`, `dist_id`, `sku_id`, `seed`, `as_of`, `lane_from`, `lane_to`.
   - New `UiAction`: `type` (enum `set_filters|navigate|select_lane`), optional `page`, `opening_state`, `dist_id`, `sku_id`, `seed`, `as_of`, `lane_from`, `lane_to`.
   - `AssistantResponse`: add optional `ui_action` (`UiAction` or null, default null).
2. Dependencies (use `npx --yes bun@1.4.4` so `bun.lock` stays at lockfileVersion 2): add `maplibre-gl@6.15.0` and `@playwright/test` (dev) to `apps/dia-next`; run `npx playwright install chromium`; copy `node_modules/.bun/maplibre-gl@6.15.0/node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs` to `apps/dia-next/public/maplibre-gl-worker.mjs`.
3. Add `.shots/` to `.gitignore`.

---

## 2. Task B: shell, navigation, data layer (runs first, with task A in parallel)

Goal: one shared frame for every page, with the assistant sidebar always visible, plus the shared hooks and helpers the page tasks import.

Files created or changed (owned by B):
`src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css` (append a clearly marked "Shell and charts" section only), `src/components/Shell.tsx`, `src/components/Header.tsx`, `src/components/AssistantPanel.tsx`, `src/context/AppContext.tsx`, `src/hooks/usePageContext.ts`, `src/hooks/useUiActions.ts`, `src/hooks/useExperiment.ts`, `src/hooks/useScenario.ts`, `src/lib/api.ts`, `src/lib/chart.ts`, `src/lib/config.ts`, `src/lib/names.ts`, and five stub routes `src/app/{demand,results,frontier,map,stock}/page.tsx` (each just a `record` section with an `empty` line; page tasks overwrite them).

What to build:

1. **Navigation (Header.tsx).** Dark-blue header as now, plus links (next/link, active via `usePathname`): Planning `/`, Demand analysis `/demand`, Results `/results`, Map `/map`, Frontier & Ablation `/frontier`, Stock watch `/stock`. Active link has a white underline. Keep the brand name and search placeholder.
2. **Shell.tsx.** Renders `<Header/>`, then the two-column grid used today (`.layout`: `.main-col` for `{children}` and `<AssistantPanel/>` on the right), then `<FooterBar/>`. `layout.tsx` wraps children in `<AppProvider><Shell>…</Shell></AppProvider>`.
3. **AppContext.tsx.** Move into one provider what `src/app/page.tsx` owns today: `usePlan()` (planId, plan, orders, ordersError, error, loading, justUpdated, refresh, switchPlan), `useAssistant()` (turns, send, resolve), `mode`/`setMode`, and the `ask` and `confirmTurn` functions. Add:
   - `pageContext` state: `{page, context, prompts}` set by `usePageContext`.
   - `ask(message, confirm?)`: sends `{plan_id: planId ?? undefined, message, mode: mode==="automatic" ? "automatic" : "ask_first", confirm?, page, context}`. After the response: if `ui_action`, call `dispatchUiAction`; else the existing behaviour (switch plan if `plan_id` changed, `refresh()` on `completed`).
   - `dispatchUiAction(action)`: `navigate` → `router.push(path of page)`; `set_filters` and `select_lane` → call the handler registered by the current page through `useUiActions`.
4. **Hooks.**
   - `usePageContext({page, context, prompts})`: sets pageContext in the provider on mount and when values change; clears on unmount.
   - `useUiActions(handler)`: registers `handler(action: UiAction)` for the current page (ref-based, no re-render loop).
5. **AssistantPanel.tsx.** Reads everything from the provider (no props for turns). Quick prompts come from `pageContext.prompts` (default: the current `QUICK_PROMPTS`). Keep the working card, collapse and confirm behaviour exactly as is.
6. **Planning page (`src/app/page.tsx`).** Becomes only the `<section className="record" data-page="planning" …>` content that was inside `main-col`, using `useApp()`. Keep Orders/Trucks/Depots/Stock at risk/Changes tabs. Also: read `?order=<dist_id>` with `useSearchParams` and pass it to `OrdersTable` as a new optional prop `initialOpenDist` (opens that order on load). Edit `OrdersTable.tsx` only for that prop (B owns this one-line change).
7. **`src/lib/api.ts`: add typed helpers** (same `request` helper, `enc` for path parts): `getScenario(id)`, `getHistory(id, distId?, skuId?)`, `getEffects(id)`, `getBacktest(id)`, `startExperiment(req)`, `getExperiment(id)`, `getResults(id)`, `getTrajectory(expId, {sku_id, dist_id, opening_state, seed})`. Types from `@dia/types`. Routes: `/v1/scenarios/{id}`, `/v1/scenarios/{id}/history?dist_id=&sku_id=`, `/v1/scenarios/{id}/effects`, `/v1/scenarios/{id}/backtest`, `POST /v1/experiments`, `/v1/experiments/{id}`, `/v1/experiments/{id}/results`, `/v1/experiments/{id}/trajectory?sku_id=&dist_id=&opening_state=&seed=`. (`getAtRisk` and `getScenarios` already exist.)
8. **`useExperiment()`** returns `{id, info, results, error, loading, reload}`. Logic: first `getExperiment(RESULT_EXPERIMENT_ID)`; if its status is `done`, use it and load `getResults`. Only if that id is missing (404) or failed, `startExperiment(MAIN_EXPERIMENT)` (this can start a ~30 minute run; the hook exposes `info.status`/`progress_pct` so pages show "running, N% done" and poll `getExperiment` every 5 s while `running`). `RESULT_EXPERIMENT_ID` is `process.env.NEXT_PUBLIC_EXPERIMENT_ID ?? "EX-acbb64e044eb"` in `config.ts`. `MAIN_EXPERIMENT` = `{policies: ["engine","baseline_a","baseline_b","abl_no_expiry","abl_no_truck_steps","abl_uniform_service"], seeds: 10, opening_states: ["neutral","imbalanced"]}` with the keys in exactly that order.
9. **`useScenario()`** returns `{scenarioId, scenario, error, loading}`: first id from `getScenarios()`, then `getScenario`.
10. **`src/lib/chart.ts`**: `linearScale(domainMin, domainMax, rangeMin, rangeMax)` returning a function; `niceTicks(min, max, count)` returning an array; `polylinePoints(points: {x:number;y:number}[])` returning the `points` string.
11. **`src/lib/names.ts`**: the dictionary in section 7 as exported constants (`POLICY_NAME`, `VARIANT_NAME`, `KPI_NAME`, `SEASON_MONTHS`), plus `POLICY_COLOUR` using the CSS variables below.
12. **CSS (globals.css, appended):** `--policy-engine: var(--brand); --policy-a: #747474; --policy-b: #9050e9;` in `:root`; the nav link styles; `.seg-btn` group rules if missing; `.chart-wrap`, `.legend`, `.caption` (small muted text under a chart), `.callout` (soft box with left border). Nothing else.

Done check: the three frontend commands pass; `bun run --cwd apps/dia-next dev` is NOT needed.

---

## 3. Task A: backend assistant additions (runs in parallel with B)

Goal: the assistant works on view pages, understands the page and filters, and can return UI actions. Only fixed tools; the model never supplies numbers.

Files owned: `apps/dia-backend/src/app.ts` (assistant route only), `apps/dia-backend/src/assistant/intent.ts`, `apps/dia-backend/src/assistant/model.ts`, new `apps/dia-backend/src/assistant/viewTools.ts`, `apps/dia-backend/src/ai/facts.ts`, `apps/dia-backend/src/ai/analyse.ts`, `apps/dia-backend/src/engine/fake.ts` (only if needed to keep fake mode working).

Read first: `src/app.ts` (route `POST /v1/assistant`, `runTool`, `buildOrders`), `src/assistant/*`, `src/ai/*`, `packages/dia-types/schema/assistant.schema.json` (new `page`, `context`, `ui_action`, optional `plan_id`).

Build:
1. `plan_id` is now optional. Load the plan only when the tool needs it; tools that need a plan (`explain_order`, `orders_status`, `credit_report`, `publish_plan`, `replan`, `whatif`) answer "Open Planning first." with status `answered` when there is none.
2. New tools (pure code, no model needed), all `answered` or `completed`, steps list with one `done` step:
   - `navigate`: sentence has open|go to|take me to|show me plus a page word (planning|plan, demand, results, frontier|ablation, map, stock). Reply "Opening <page>." and `ui_action {type:"navigate", page}`.
   - `set_view`: on any page except planning, parse from the sentence: neutral|imbalanced → `opening_state`; a distributor city or depot name (from `engine.scenario()` nodes) → `dist_id`; a product name (substring of an SKU name, case-insensitive) → `sku_id`; `seed 1|2` → `seed`; an ISO date → `as_of`. Reply "Showing …" and `ui_action {type:"set_filters", …only the keys found}`. If no key is found, fall through.
   - `select_lane` (page `map` only): a depot word → `lane_from`; with a city → `lane_to`. Reply "Showing lanes from …" and `ui_action {type:"select_lane", …}`.
   - `explain_results`: page `results` or `frontier`, words like results|scorecard|worse|better|baseline|fill rate|cost|ablation|expiry|service level|why. Needs `context.experiment_id`; check it is `done` in `repo.getExperiment`, load `engine.experimentResults`, build `resultsFacts(res, openingState(context.opening_state))`, call the existing `analyse(llm, facts, message)`. If not ready: "The results are not ready yet."
   - `explain_demand`: page `demand`, words like forecast|demand|accuracy|error|seasonal|festival|weather|why. Build `demandFacts(backtest, effects)` in `facts.ts` (kind `"demand"`: the five backtest numbers, plus per category the learned vs configured heat and May seasonality, plus mean festival gap) and add a `demandRules` text for the offline path in `analyse.ts` (plain English, states that festival uplift is recovered closely and seasonality and heat only weakly). Call `analyse`.
   - `check_at_risk` on page `stock`: use `context.as_of` and the first scenario id when there is no plan.
3. Order of matching: on pages other than planning, try `navigate`, `select_lane`, `set_view`, then the page's explain tool, then the existing rules. On planning, behaviour is unchanged.
4. `model.ts`: add the new tool names to the model prompt and `validateRoute`: `navigate` (page must be in the enum), `set_view` (checks: `opening_state` in the two values, `dist_city` must match a city, `sku_name` must match a product, `seed` 1 or 2, `as_of` a valid date), `explain_results`, `explain_demand`. Anything invalid is dropped.
5. Response: set `ui_action` when a tool returns one; `source` stays `"rules"` or `"ai"` as today.

Done check: `bunx tsc --noEmit -p apps/dia-backend` clean and `bun test apps/dia-backend` all passing (currently 54 pass, 6 skip). No new test files required.

---

## 4. Page tasks (run in parallel after B and A finish)

Common to all: use `useApp`, `usePageContext`, `useUiActions`, `useExperiment`/`useScenario` from task B. Overwrite your stub route. Put components and CSS Modules in a folder named after the page: `src/components/<page>/`.

### P1: Results and Frontier & Ablation (one agent, two routes)

Files: `src/app/results/page.tsx`, `src/app/frontier/page.tsx`, `src/components/results/*`, `src/components/frontier/*`, `src/lib/results.ts`.
Port logic (not styles) from `apps/dia-web/src/pages/AnalyticsPages.tsx`: `KPI_META`, `targetFor`, `bestBaseline`, the "worse" list, `WORSENS_CAUSE`, `FrontierChart`, `AblationBars`. Put KPI meta, targets and formatters in `src/lib/results.ts`.

**/results** layout, top to bottom:
1. Record head: kind "Evaluation", title "Results: engine against the better of two simple policies", right side `seg-btn` group "Neutral start" / "Imbalanced start" (default imbalanced) and a "Reload" button. Sub line: "Means over N seeds with 90% ranges. Every policy faces the same demand, delays and promotions."
2. `notice` while the experiment runs: "Experiment EX-… is running, N% done. This page refreshes itself."
3. `.strip` of four metrics: Total cost to serve, Demand met, Stock wasted, Freight per case. Each: engine value, and under it "−₹x lakh (−15%) against the better policy" in green or red.
4. `.callout` "Where the engine is worse, and why" immediately under the strip (lead with the trade-off): one line per worse KPI with the difference and the stored cause sentence.
5. Line "N of 10 targets met" with a short note that unmet targets are shown as measured.
6. `table-wrap` scorecard, columns: Measure | Even split | Reorder rule | Engine | Engine against better policy | Target | Met. Cells show the mean, with "± range" in smaller muted text on a second line. Met column uses `status` pills (green Met, red Not met).
7. Footer note: "Simulated sales and stock; real weather. Numbers are the stored run's, not a forecast."
Quick prompts: "Analyse these results", "Why is demand met lower?", "Show the neutral start". UI action: `set_filters.opening_state` flips the toggle. Context sent: `{experiment_id, opening_state}`.

**/frontier** layout:
1. Record head: kind "Evaluation", title "Cost against service", the same toggle.
2. `.box` "Demand met against cost to serve": the line chart (one line per policy, points labelled with the knob value, a larger ring on each policy's default setting: engine 1, even split 14 days, reorder rule 95%), legend, caption "Further up and to the left is better. Each line is one policy at different settings."
3. `.box` "What each part of the engine is worth": ablation bars with the interval whisker, table underneath (Switched off | Cost change | Demand met change | Wasted stock change), caption "A bar to the right means the engine saves that much with this part on. A bar to the left means the engine did better without it."
4. If a section has no rows, an `empty` line instead.
Quick prompts: "What does the expiry part save?", "Why was one service level cheaper?". Context: `{experiment_id, opening_state}`.

### P3: Demand analysis

Files: `src/app/demand/page.tsx`, `src/components/demand/*`.
Port logic from `apps/dia-web/src/pages/DemandPage.tsx` (`HistoryChart`, `SeasonChart`, `Learned`). Data: `useScenario`, `getHistory`, `getEffects`, `getBacktest`.

Layout:
1. Record head: kind "Evaluation", title "Demand analysis"; filters: distributor select (All, or a city) and product select (All, or a product); small muted label with `history.label`.
2. `.strip` of five: Forecast error (with "last year's pattern: X%" beneath), Better than last year's pattern (percent, computed 1 − wape/naive), Bias (signed), Weeks inside the 80% range, Forecast error in festival weeks.
3. `.box` "Weekly demand and the forecast": the history chart (festival run-ups shaded with names, a dashed marker where the test window starts, the backtest forecast line, the 80% range band when one distributor and one product are chosen), legend, caption. If `has_band` is false: caption "Pick one distributor and one product to see the 80% range."
4. `.box` "What the forecaster learned": festival uplift table (Festival | Product group | Learned | Configured | small bar) with the mean gap in a `status` pill; below it two columns: seasonality line chart (learned vs configured) with a category select, and the weather table (heat and rain: learned / configured).
5. `.callout` "How to read this": festival uplifts are recovered closely; monthly seasonality and the heat effect only weakly because the model follows the season through its weekly level; the simulator and the model share structure, so error figures flatter the model. (Same meaning as the old page; keep it.)
Quick prompts: "Explain the forecast accuracy", "Show Kolkata cola", "Why is the heat effect low?". UI action: `set_filters` with `dist_id` and `sku_id` sets the selects. Context: `{dist_id, sku_id}`.

### P4: Map

Files: `src/app/map/page.tsx`, `src/components/map/*`, `src/lib/mapColors.ts`.
Port from `apps/dia-web/src/components/NetworkMap.tsx` and `MapPage` in `AnalyticsPages.tsx`. Needs the current plan from `useApp()`; if there is none, show `empty`: "Create a plan on Planning first."

Build:
- `NetworkMap.tsx`: client component loaded with `next/dynamic(() => import(...), { ssr: false })`. MapLibre GL with OpenStreetMap raster tiles; `maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs")` before creating the map; CSS from `maplibre-gl/dist/maplibre-gl.css`. Lanes as GeoJSON curves, width by `sqrt(cases/max)`, colour by main reason (hex constants in `mapColors.ts`, since MapLibre cannot read CSS variables); depot squares and distributor dots as markers with city labels; click a lane to select it; fit bounds to the nodes.
- Fallback: if creating the map throws or WebGL is missing, render the SVG map instead (`NetworkMapSvg.tsx`): projection `x = 20 + (lon − 68) × 0.93 × 20`, `y = 20 + (36 − lat) × 20`, viewBox 600×600, same lanes and colours, no tiles. With no network, the MapLibre map still shows lanes on a plain background.
Layout: record head (kind "Planning cycle", title "Network map", sub "Version N · lane width shows cases · colour shows the main reason"); the map (height 520, 1px `--line` border, 4px radius); a legend of reason colours in plain words (`reasonLabel`); under the map a `table-wrap` of lanes (From | To | Cases | Main reason | Freight) sorted by cases, clicking a row selects it; a `.box` for the selected lane with its products and cases and a link "Open this order" to `/?order=<dist_id>`.
Quick prompts: "Which lane carries the most cases?", "Show only Dankuni lanes". UI action: `select_lane` selects/filters. Context: `{lane_from, lane_to}`.

### P5: Stock watch

Files: `src/app/stock/page.tsx`, `src/components/stock/*`.
Data: `getAtRisk`, `getTrajectory`, `useExperiment`, `useScenario`.

Layout:
1. Record head: kind "Planning cycle", title "Stock watch"; an "As of" date input (default `AS_OF`, min 2025-09-29, max 2025-12-21) and a Refresh button.
2. `.strip`: Lots at risk, At depots, At distributors, Cases at risk (sum of `stock_cases`).
3. `.box` "Stock that may expire": chips All / Depots / Distributors with counts; table: Where (city plus a `status` pill "Depot" or "Distributor") | Product | Expires (date and "N days") | Cases | Sells per day | Days to sell | Expected to expire (cases, one decimal) | What to do. Row click selects it for the next box. `empty` state: "Nothing is at risk on this date."
4. `.box` "Stock over the 12 weeks": selects for product and place (all nodes) and a `seg-btn` for Neutral / Imbalanced and a seed 1 / 2 toggle; pre-selected from the clicked row. Uses `useExperiment`; while the experiment runs show "Running, N% done". When done and a selection exists, call `getTrajectory`; SVG line chart of closing cases by date, one line per policy (engine, even split, reorder rule), legend, caption "Stock left at the end of each day. Only the first two seeds keep daily records."; below, a small table per policy: total sold, total missed, total expired. A 404 shows "No daily record for this selection."
Quick prompts: "Which stock expires first?", "Show Kolkata cola". UI action: `set_filters` sets `as_of`, `dist_id`, `sku_id`, `opening_state`, `seed`. Context: `{as_of, dist_id, sku_id, opening_state, seed, experiment_id}`.

---

## 5. Step 3 (orchestrator, after all tasks): look at it

1. Start backend (`bun src/index.ts` in `apps/dia-backend`) and the Next dev server on 3001.
2. Playwright script `apps/dia-next/scripts/shots.mjs`: for each route (`/ /demand /results /map /frontier /stock`) at 1440×900, wait for `[data-ready="true"]` (max 20 s), save `.shots/<name>.png`.
3. The orchestrator views each image and writes a fix list; one pass of small fixes; re-shoot only the changed pages.
4. `typecheck`, `lint`, `build`; commit to a feature branch; open a PR.

Not tested on purpose: unit tests for the new pages. The screenshot pass is the check.

---

## 6. File ownership (so parallel agents never collide)

| Owner | Files |
|---|---|
| Step 0 (orchestrator) | `assistant.schema.json`, generated types, `apps/dia-next/package.json`, `bun.lock`, `public/maplibre-gl-worker.mjs`, `.gitignore` |
| B | `layout.tsx`, `page.tsx`, `globals.css` (append only), `Shell`, `Header`, `AssistantPanel`, `OrdersTable` (one prop), `context/AppContext.tsx`, `hooks/*` (usePageContext, useUiActions, useExperiment, useScenario), `lib/{api,chart,config,names}.ts`, 5 stub routes |
| A | backend files listed in section 3 |
| P1 | `app/results`, `app/frontier`, `components/results`, `components/frontier`, `lib/results.ts` |
| P3 | `app/demand`, `components/demand` |
| P4 | `app/map`, `components/map`, `lib/mapColors.ts` |
| P5 | `app/stock`, `components/stock` |

---

## 7. Plain-language dictionary

| Internal | Show |
|---|---|
| engine | Engine |
| baseline_a | Even split |
| baseline_b | Reorder rule |
| abl_no_expiry | No expiry costs |
| abl_no_truck_steps | No whole-truck pricing |
| abl_uniform_service | One service level for every product |
| abl_naive_forecast | Last year's pattern as the forecast |
| abl_no_credit | No credit limit |
| abl_home_depot | Home depot only |
| fill_rate | Demand met |
| festival_fill_rate | Demand met in festival weeks |
| stockout_rate | Days out of stock |
| lost_margin_inr | Margin lost to stockouts |
| wastage_inr | Stock wasted (expired) |
| freight_inr_per_case | Freight per case |
| ftl_utilisation | Truck fill |
| cost_to_serve_inr | Total cost to serve |
| cover_extremes | Days with too little or too much stock |
| co2_kg_per_case | CO₂ per case |
| WAPE | Forecast error |
| coverage P10 to P90 | Weeks inside the 80% range |
| opening state neutral / imbalanced | Neutral start / Imbalanced start |
| experiment | Evaluation run |

---

## 8. Known risks

- **A fresh evaluation run takes about 30 minutes.** `useExperiment` reads the stored run `EX-acbb64e044eb` first and only starts a new one when that id does not exist. Editing `packages/dia-config/config.yaml` text changes the id the backend would compute, so do not edit it before the demo.
- **MapLibre in Next.** Needs the worker file in `public/`. If the map fails to start, the SVG fallback must show; headless Chromium may have no WebGL, so screenshots may show the fallback.
- **Daily stock curves** exist only for seeds 1 and 2.
- **The assistant** changes filters through `ui_action`; it never sets quantities.
- **Numbers shown are the live ones**, not the figures in `docs/Demo.md`.
