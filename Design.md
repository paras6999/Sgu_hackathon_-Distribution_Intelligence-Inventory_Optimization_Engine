# Design.md — Visual design (Streamlit app)

## Principles
- Planner-first: dense but readable tables; every number traceable to a source row.
- Show the reason, not just the quantity: reason-code chips on every plan line.
- Rupee figures always visible next to trade-offs.

## Colour (light theme default)
| Token | Hex | Use |
|---|---|---|
| Primary | #1F4E79 | Headers, primary buttons, engine series |
| Accent | #E07B00 | Highlights, festival markers |
| Success | #2E7D32 | Fill-rate gains, accepted |
| Warning | #F9A825 | Near-expiry, trimmed |
| Danger | #C62828 | Stockout, expiry, rejected |
| Neutral | #5F6B7A | Baseline A, secondary text |
| Baseline B | #8E9AAF | Baseline B series |
| Background | #F7F9FB | Page |
| Surface | #FFFFFF | Cards |

Policy colours are consistent in every chart: Engine = Primary, Baseline A = Neutral, Baseline B = #8E9AAF.
Reason-code colours: CHEAPEST_SOURCE blue, EXPIRY_PUSH red, FTL_TOPUP teal, FESTIVAL_UPLIFT orange, WEATHER_SHIFT sky blue, *_LIMITED grey.

## Typography
- Font: Inter (fallback: system sans-serif); monospace for IDs and config values.
- Page title 24px/600, section 18px/600, body 14px/400, table 13px.
- INR in Indian grouping (e.g. ₹3.2 lakh, ₹25.0 cr).

## Layout
Tabs: Plan | Dispatch | Distributor inbox | Results | Frontier | Ablation | Map | Assumptions.
- KPI cards in a row: value, delta vs better baseline, 90% CI.
- Plan table beside the map; clicking a map arc filters the table to that lane.
- Distributor inbox styled as a WhatsApp-like chat panel (message bubbles, accept/trim/reject buttons).

## Charts
- plotly for the frontier (fill rate vs cost to serve) and ablation waterfall; pydeck for map arcs (width ∝ cases, colour = primary reason code).
- Label axes with units; show CI bands; show at least one KPI that worsens and why.

## Accessibility
- Text contrast >= 4.5:1; never rely on colour alone (use labels or icons for status).
- Dark theme uses the same tokens with inverted surfaces.
