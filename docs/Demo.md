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
| 3:30 | Results | 10 seeds × 2 opening states, identical demand, delays and promotions for every policy. Engine vs the better of two baselines, with 90% intervals. Point at the red box: **fill rate, stockouts and cover extremes are worse** and why. |
| 4:30 | Frontier & Ablation (frontier) | Each policy swept over its own knob: more stock buys fill rate at a price; the engine's curve sits up and to the left. |
| 5:15 | Frontier & Ablation (ablation) | Switch off the expiry term or whole-truck costs and cost to serve rises by ₹ — expiry terms and whole-truck steps earn their place; the per-SKU service levels do not (the engine is slightly cheaper without them). Say so. |
| 6:00 | Plan line → reason code | Pick one reason code and show the number behind it (e.g. cliff rescue: the lot, the date, the write-off avoided). |
| 6:30 | Assumptions | Every business number, with a source or marked "judgment". The data is simulated except weather (real Open-Meteo), city locations and populations, and festival dates. |

## Numbers to quote (run `EX-de4798536119`: real weather, 10 seeds, both opening states, 90% paired intervals; engine vs the better baseline)
| KPI | Neutral start | Imbalanced start | Target met? |
|---|---|---|---|
| Total cost to serve | ₹1.75 cr vs ₹2.06 cr: **−₹31 lakh (−15%)** | ₹1.84 cr vs ₹2.17 cr: **−₹33 lakh (−15%)** | yes / yes |
| Wastage | ₹1.9 lakh vs ₹7.0 lakh: **−72%** | ₹1.6 lakh vs ₹8.9 lakh: **−82%** | yes / yes |
| Freight per case | ₹72 vs ₹89: **−20%** | ₹72 vs ₹89: **−19%** | yes / yes |
| FTL utilisation | 80% vs 64% | 80% vs 64% | no (target 85%) |
| CO₂ per case | 0.63 vs 0.80 kg: **−22%** | 0.63 vs 0.81 kg: **−22%** | yes / yes |
| Fill rate | 95.6% vs 96.0%: **−0.4 pp** | 94.1% vs 94.9%: **−0.8 pp** | no (target +2 / +4 pp) |
| Stockout rate | 3.7% vs 3.2%: +0.4 pp | 5.7% vs 4.8%: +0.9 pp | no |
| Lost margin | +₹1.8 lakh | +₹2.6 lakh | no |
| Cover extremes | 10.9% vs 3.6% | 12.2% vs 5.4% | no |

**Say it plainly:** the engine cuts cost to serve by about 15%, waste by three quarters and CO₂ by a fifth, and gives up 0.4–0.8 points of fill rate. Four of the PRD's ten targets are met (cost, wastage, freight per case, CO₂); fill rate, stockouts, lost margin, FTL utilisation (80% against 85%) and cover extremes are not.

**Ablations (cost to serve when a mechanism is switched off, neutral / imbalanced):** expiry terms +₹18 lakh / +₹18 lakh (about +10%); whole-truck freight steps +₹37 lakh / +₹40 lakh (about +21%); a single service level for every SKU **−₹6 lakh / −₹2 lakh** — the engine does slightly better without its per-SKU service levels, so that mechanism does not pay in this setup.

**Frontier (engine, stockout weight 0.5 / 1 / 2, imbalanced):** fill 93.3% / 93.9% / 94.1%, cost ₹1.79 / ₹1.82 / ₹1.89 cr. Baseline A needs 14 days of cover to reach 94.7% fill, at ₹2.18 cr (the engine reaches 94.1% at ₹1.89 cr); Baseline B never gets above 86.5%, even at ₹3.14 cr. Frontier points use the first 5 seeds.

## Analysis on demand and the map
- **Analyse** buttons on the Plan and Results tabs give a deep analysis of the plan or the results. With no AI model configured (the default) the text is built from the data by rules and works offline. With `AI_ENABLED=true` and Vertex AI credentials in `.env`, a Gemini model writes it from the same facts; every figure it quotes is checked against the data and flagged if it does not match. The model never sets a quantity, and a free-form question box is available when the model is on.
- **Map:** a MapLibre map on OpenStreetMap tiles (needs a network; without one the lanes still show on a plain background, and without WebGL the page falls back to the drawn map). Click an arc to filter the lines below.

## Likely questions
- **Is the data real?** Demand, stock lots, orders and delays are simulated — no brand publishes them. Weather is real (Open-Meteo, 16 cities, Sep 2023 – Dec 2025), as are locations, populations and festival dates. The simulator is checked against real-world benchmarks (turnover per distributor, Diwali uplift, summer beverages, a ~4% stockout rate, ~7 t per distributor-week).
- **Where do the formulas come from?** The model is in `docs/PRD.md` §6.6: exponential smoothing / TSB forecasts, newsvendor service levels, a mixed-integer programme with ten constraints (stock, trucks, part-load freight, storage, credit, expiry, distributor locks). Standard methods; the parameters are in the Assumptions tab, each with a source or marked judgment.
- **Does an AI choose the quantities?** No. An optimiser does. AI narration is optional, off by default, and cannot change a number.
- **Why is fill rate lower?** The engine ships a case only when the expected margin beats freight, holding and expiry cost. It runs fuller trucks and wastes less, and accepts a few more stockouts on thin lanes. The frontier shows how to buy that fill rate back, and what it costs.
- **Why is the home-depot ablation not shown?** The four depots are 1,000+ km apart, so no alternative depot qualifies within 600 km: the result would be zero. We dropped it rather than show an empty bar.
- **What did you tune on the evaluation seeds?** One setting: the stockout penalty (1.2 → 2.4 × margin), chosen from the first run's frontier on seeds 1–5, which are also in the evaluation. It is disclosed in the Assumptions tab.
- **What is not built?** Live data connectors, carbon pricing in the UI (the optimiser accepts it), multi-drop routes, and ablations (c) no-credit and (f) home-depot. The Vertex AI path is built and tested against a mocked endpoint only; it has not been run against a real Vertex project.
- **How is the result protected from a bug?** Every plan is re-checked by an independent validator before it is shown; the simulator asserts stock conservation on every node, SKU and day (0 failures in about half a million rows per run).

## Future scope
- **Decisions:** multi-drop routes for chilled (FR-17), lateral rebalancing between distributors and depots (FR-18), and a two-stage, multi-period model for festival pre-build (FR-28; today the model is single-period and pre-builds by lengthening the cover window).
- **Planner tools:** a what-if panel for a demand shock, a depot outage or diesel +10% (FR-19); planner line overrides with the ₹ cost shown (FR-22); a near-expiry list and per-SKU drill-down (FR-20, FR-21); a heat-season evaluation window (FR-23); a timed scale benchmark (FR-24).
- **Real world:** a 4-week shadow pilot in one real region; messy distributor Excel ingestion and live DMS connectors (FR-26); WhatsApp Business messaging (FR-29); carbon price in the UI (FR-13; the optimiser already accepts it).
- **Model work the results point to:** close the fill-rate gap (the lost-sales model assumes a shipment is available on day 0 although it arrives after the lead time) and revisit per-SKU service levels, which did not pay in the ablation.
