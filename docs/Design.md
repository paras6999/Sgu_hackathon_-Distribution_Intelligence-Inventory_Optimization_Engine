# Design.md — Visual design (web app `apps/dia-web`, solo build)

## Principles
- Planner first: dense but readable tables; every number traces to a source row.
- Show the reason, not just the quantity: reason-code chips on every plan line.
- Rupee figures sit next to every trade-off.
- One page per user journey (PRD §4); each screen calls the API only.

## Screens and the API they use

| Tab | Journey / FR | Shows | Endpoints |
|---|---|---|---|
| Plan | J1, FR-07 | Scenario + date picker, temperature class, stockout and carbon sliders, KPI cards, plan table with reason chips, forecast exceptions, "Send to distributors" | `GET /v1/scenarios`, `POST /v1/forecasts`, `POST /v1/plans`, `POST /v1/plans/{id}/publish` |
| Map | FR-14 | Depots and distributors; arc width ∝ cases, arc colour = primary reason code; depot bubble ∝ near-MRSL stock; click arc filters the plan table | `GET /v1/plans/{id}`, `GET /v1/scenarios/{id}/snapshot` |
| Dispatch | J3, FR-07 | Truck cards (class, destination, kg % and m³ % bars, FEFO pick list); CSV download | `GET /v1/plans/{id}/dispatch`, `…/dispatch.csv` |
| Distributor inbox | J2, FR-08 | WhatsApp-style chat: proposal text, lines with life on arrival, value vs credit; accept / trim / reject; change log for the planner | `GET …/proposals`, `GET …/inbox/{dist}`, `POST …/responses`, `GET …/events` |
| Results | J4, FR-11 | Opening-state toggle; KPI cards per policy with mean and 90% CI; paired delta vs better baseline; one KPI that worsens and why | `POST /v1/experiments`, `GET /v1/experiments/{id}`, `…/results` |
| Frontier & Ablation | FR-11, FR-12 | Fill rate vs cost-to-serve curves per policy; waterfall of ₹ contribution per mechanism | `…/results` |
| Assumptions | FR-15 | `config.yaml` as a table: parameter, value, unit, source or "judgment" | `GET /v1/assumptions` |

## Colour tokens (light theme default)

| Token | Hex | Use |
|---|---|---|
| Primary | `#1F4E79` | Headers, primary buttons, Engine series |
| Accent | `#E07B00` | Highlights, festival markers |
| Success | `#2E7D32` | Gains, accepted lines |
| Warning | `#F9A825` | Near-expiry, trimmed lines |
| Danger | `#C62828` | Stockout, expiry, rejected lines |
| Neutral | `#5F6B7A` | Baseline A, secondary text |
| Baseline B | `#8E9AAF` | Baseline B series |
| Background | `#F7F9FB` | Page |
| Surface | `#FFFFFF` | Cards |

Tokens live as CSS variables in `apps/dia-web/src/theme.css` (light default, dark via `prefers-color-scheme`). The emergency Streamlit app uses the same colours in `apps/dia-fallback-ui/.streamlit/config.toml`.

Policy colours stay the same in every chart: Engine = Primary, Baseline A = Neutral, Baseline B = `#8E9AAF`.

Reason-code colours: `CHEAPEST_SOURCE` blue `#1565C0`, `EXPIRY_PUSH` red `#C62828`, `CLIFF_RESCUE` dark red `#8E0000`, `FTL_TOPUP` teal `#00897B`, `FESTIVAL_UPLIFT` orange `#E07B00`, `WEATHER_SHIFT` sky `#039BE5`, all `*_LIMITED` / `MRSL_BLOCKED` / `FAIR_SHARE_FLOOR` grey `#5F6B7A`.

## Typography
- Font: Inter (fallback system sans-serif); monospace for IDs, lot numbers and config values.
- Page title 24 px / 600, section 18 px / 600, body 14 px / 400, tables 13 px.
- INR in Indian grouping: ₹3.2 lakh, ₹25.0 cr; cases as integers; percentages with one decimal.

## Layout
- Wide layout; KPI cards in one row at the top of Plan and Results: value, delta vs better baseline, 90% CI.
- Plan table and map side by side on wide screens, stacked on narrow ones.
- Inbox looks like a chat: message bubble with the proposal, then line cards with action controls.
- A "FAKE DATA" caption shows whenever `/v1/health` reports the fake backend, so nobody demos fakes by mistake.

## Charts
- plotly for frontier and ablation waterfall; pydeck for the map.
- Always label axes with units; show CI bands or whiskers; reporting rules from PRD §8.7 (both opening states side by side, never one seed).

## Accessibility
- Text contrast ≥ 4.5:1; never colour alone (status also as text or icon).
- Dark theme uses the same tokens with inverted surfaces.
