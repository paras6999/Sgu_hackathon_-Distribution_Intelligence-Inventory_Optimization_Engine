# Demo.md — Running the demo and answering questions

## Start the demo (network can be off)
```bash
bun run setup        # once
bun run data         # only if data/engine is missing: builds the simulated scenarios (real weather is cached in weather_daily.parquet)
bun run dev          # backend (starts the engine) on :8000, web on :3000
```
Open http://localhost:3000. Pre-warm once: Plan tab → Generate plan (first call computes forecasts, about 10 s). The Results, Frontier and Assumptions tabs read the cached experiment (`EX-…` shown on the page); they never start a new run unless the config or request changed.

## The 7-minute script
| Time | Screen | Say |
|---|---|---|
| 0:00 | Slide / Plan tab | A brand ships from 4 regional depots to 16 distributors on credit. Every Monday a planner decides who gets which lot, in which truck. Wrong calls mean empty shelves, expired stock and half-empty trucks. |
| 0:45 | Map | The imbalanced start: one depot holds snack lots at 62–70% of shelf life (just above the 60% floor), the North is short before Diwali, one distributor is overstocked on slow SKUs. |
| 1:30 | Plan → Generate plan | The engine plans one cycle in about 2–3 s. Every line carries the reason: cheapest source, expiry push, cliff rescue, festival uplift, credit limit. Quantities come only from the optimiser, never from an AI model. |
| 2:30 | Send to distributors → Distributor inbox | Distributor trims a line. The plan re-solves in about 2 s: the trimmed stock stays at the depot or goes to distributors who can use it, nobody who has already answered is touched. The log shows the ₹ impact. |
| 3:30 | Results | 10 seeds × 2 opening states, identical demand, delays and promotions for every policy. Engine vs the better of two baselines, with 90% intervals. Point at the red box: **fill rate is lower** and why. |
| 4:30 | Frontier & Ablation (frontier) | Each policy swept over its own knob: more stock buys fill rate at a price; the engine's curve sits up and to the left. |
| 5:15 | Frontier & Ablation (ablation) | Switch off the expiry term or whole-truck costs and cost to serve rises by ₹ — each mechanism earns its place. One mechanism (uniform service level) does not matter. Say so. |
| 6:00 | Plan line → reason code | Pick one reason code and show the number behind it (e.g. cliff rescue: the lot, the date, the write-off avoided). |
| 6:30 | Assumptions | Every business number, with a source or marked "judgment". The data is simulated except weather (real Open-Meteo), city locations and populations, and festival dates. |

## Numbers to quote
See the final section, filled from the cached run.

## Likely questions
- **Is the data real?** Demand, stock lots, orders and delays are simulated — no brand publishes them. Weather is real (Open-Meteo, 16 cities, Sep 2023 – Dec 2025), as are locations, populations and festival dates. The simulator is checked against real-world benchmarks (turnover per distributor, Diwali uplift, summer beverages, a ~4% stockout rate, ~7 t per distributor-week).
- **Where do the formulas come from?** The model is in `docs/PRD.md` §6.6: exponential smoothing / TSB forecasts, newsvendor service levels, a mixed-integer programme with ten constraints (stock, trucks, part-load freight, storage, credit, expiry, distributor locks). Standard methods; the parameters are in the Assumptions tab, each with a source or marked judgment.
- **Does an AI choose the quantities?** No. An optimiser does. AI narration is optional, off by default, and cannot change a number.
- **Why is fill rate lower?** The engine ships a case only when the expected margin beats freight, holding and expiry cost. It runs fuller trucks and wastes less, and accepts a few more stockouts on thin lanes. The frontier shows how to buy that fill rate back, and what it costs.
- **Why is the home-depot ablation not shown?** The four depots are 1,000+ km apart, so no alternative depot qualifies within 600 km: the result would be zero. We dropped it rather than show an empty bar.
- **What did you tune on the evaluation seeds?** One setting: the stockout penalty (1.2 → 2.4 × margin), chosen from the first run's frontier on seeds 1–5, which are also in the evaluation. It is disclosed in the Assumptions tab.
- **What is not built?** Real AI narration, a basemap on the network map, live data connectors, carbon pricing in the UI (the optimiser accepts it), multi-drop routes, and ablations (c) no-credit and (f) home-depot.
- **How is the result protected from a bug?** Every plan is re-checked by an independent validator before it is shown; the simulator asserts stock conservation on every node, SKU and day (0 failures in about half a million rows per run).
