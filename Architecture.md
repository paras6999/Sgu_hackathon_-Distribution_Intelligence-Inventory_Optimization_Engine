# Architecture.md — Vitaran

Source of truth: PRD.md §6. This file summarises app flow, file structure and stack.

## Flow
```
config.yaml + Open-Meteo cache -> Scenario generator -> Parquet store
Parquet -> Forecast (AutoETS/TSB x festival/promo/weather) -> Targets (newsvendor S)
        -> Allocation MILP (PuLP + HiGHS) -> Validator -> Reason codes -> Plan
Plan -> FastAPI -> Streamlit app + Distributor inbox (accept / trim / reject -> locked re-solve)
Simulation harness (84 days, 20 seeds, 2 opening states) -> Engine vs Baselines A/B + ablations -> kpi_results
```

## Tech stack
| Layer | Choice | Fallback |
|---|---|---|
| Language | Python 3.11 | - |
| Data | pandas, numpy, pyarrow | CSV |
| Forecast | statsforecast (AutoETS, TSB, SeasonalNaive) | Seasonal naive |
| Optimisation | PuLP >= 2.8 + HiGHS (highspy) | CBC |
| Config/contracts | PyYAML + pydantic v2 | - |
| API | FastAPI + uvicorn | In-process calls |
| UI | Streamlit, pydeck, plotly | Static HTML report |
| Parallel | multiprocessing (one process per seed) | Fewer seeds |
| Tests | pytest | - |
| Weather | Open-Meteo archive, fetched once and cached | Synthetic seasonality |

## Folder structure
```
vitaran/
├── config/config.yaml
├── data/                  # generated parquet + weather cache (make data)
├── engine/
│   ├── models.py          # pydantic contracts shared with API
│   ├── generate.py        # FR-01 scenario generator
│   ├── weather.py         # FR-02
│   ├── forecast.py        # FR-03
│   ├── targets.py         # FR-04
│   ├── optimize.py        # FR-05 allocation MILP
│   ├── validate.py        # independent constraint checker
│   ├── explain.py         # FR-06 reason codes
│   ├── baselines.py       # FR-10
│   ├── simulate.py        # FR-09
│   └── kpi.py             # FR-11/12/13
├── api/main.py            # FR-16
├── app/streamlit_app.py   # plan, dispatch, inbox, results, map, assumptions
├── scripts/run_experiments.py
├── tests/
└── Makefile               # make data | make experiments | make app
```

## API (10 endpoints, /v1)
snapshot, forecasts, plans, plans/{id}/publish, plans/{id}/responses (409 on stale proposal version),
plans/{id}/dispatch, dispatch.csv, experiments (202), experiments/{id}, experiments/{id}/results.

## Key design decisions
- One network-wide MILP per temperature class (chilled every 2 days, ambient weekly).
- Lost sales and expected waste are convex piecewise-linear curves, so no extra binaries.
- Every instance is feasible by construction (x = 0); locks come from a validated earlier version.
- Reason codes are rules applied after the solve and checked by counterfactual re-solves.
- All business parameters come from config.yaml.
