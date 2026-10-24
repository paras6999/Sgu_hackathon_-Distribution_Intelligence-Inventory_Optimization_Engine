# M4 · Data — realistic synthetic datasets (@Shanurrr)

Tool: any (the agent should read `AGENTS.md` first). Work happens when needed; nobody is blocked on you, because **generator v0 already produces all scenario tables**. Your job is to make the data more believable and better sourced.

## Your folders
| Allowed | Path |
|---|---|
| ✅ own | `engine/dia-engine/src/dia_engine/data/` (`generate.py`, `weather.py`) |
| ✅ own (values) | `packages/dia-config/config.yaml` catalogue, categories, demand, calendar, supply; `climate.yaml`; their `assumptions` entries |
| ✅ add | checks in `engine/dia-engine/tests/test_realism.py` |
| ❌ don't edit | table columns in `store.TABLES`, the config schema (`config.py`) — ask M2 · anything else |

## Setup and loop
```bash
bun run setup
bun run data                                   # generates seed01 and prints the realism summary
uv run --package dia-engine pytest engine/dia-engine/tests/test_realism.py -q
```

## Rules (from docs/Rules.md)
- Every number has a real basis or a `judgment` tag with a one-line rationale in `assumptions`.
- Randomness only as calibrated noise around realistic means. Same seed ⇒ same data.
- Unannounced promos and the regional shock must stay out of the `events` table.
- If a realism check fails, fix the generator or config, not the test range (unless you add a source for the new range).

## Tasks (pick in order)
1. `dia-engine weather --fetch` once (needs network) and compare real Open-Meteo history with the `climate.yaml` fallback; fix any city that is far off.
2. Add sources for the SKU catalogue (pack sizes, MRPs) and category margins (annual reports of listed FMCG firms).
3. **Open issue — chilled freight:** small reefer loads make chilled freight ~25–30% of chilled value. Propose a realistic fix with M1 (higher dairy volumes, smaller vehicles, or multi-drop milk runs, FR-17).
4. Add checks: festival-week fill of 32 ft trucks, freight as % of revenue (target ~2–3% ambient), distributor stock cover.
5. Regional festival coverage: add Navratri / Chhath / Bihu if they change regional demand materially.

## PR checklist
Branch `m4/<task>` · `bun run test:engine` green · realism summary in the PR description · every new value has an `assumptions` entry · `Memory.md` line · reviewer M2.
