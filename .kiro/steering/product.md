---
inclusion: always
---
# Product: Vitaran (DIAgent)

A distribution-planning engine for a consumer-goods brand. Each planning cycle it decides which SKU, from which depot lot, to which distributor, how many **cases**, in which truck, shows the reason and the rupee impact for every line, and proves itself in a simulation against two baselines.

- Network: 4 depots, 16 distributors, 24 SKUs (4 chilled). Simulated sales and stock; real weather, locations, festival dates.
- Users: a planner (generates and reviews the plan), distributors (accept, trim, reject their proposal), a judge or buyer (Results, Frontier, Demand analysis, Assumptions).
- Result of record: cost to serve −15%, wastage −72% to −82%, freight per case −20%, CO₂ −22%; fill rate 0.4 to 0.8 points **lower**. Always state the weakness with the strength.
- Hard rules: quantities come only from the optimiser or a baseline, never from an AI model; every plan is validated before it is shown; every business number is in `packages/dia-config/config.yaml` with a source or marked `judgment`; no invented citations.
- Full context: `docs/Handoff.md`. Requirements: `docs/PRD.md`. Open work: `docs/Backlog.md`.
