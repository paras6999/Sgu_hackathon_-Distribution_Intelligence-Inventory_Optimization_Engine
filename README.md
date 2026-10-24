# Vitaran — Distribution Intelligence & Inventory Optimization Engine

Hackathon Problem Statement 2. One network-wide decision per planning cycle: forecast → targets → mixed-integer allocation (depot, lot, quantity, truck) → reason codes → distributor confirmation → simulated proof against two baselines.

## Read in this order
| File | What it is |
|---|---|
| [PRD.md](PRD.md) | What we build and why (requirements, journeys, metrics) |
| [Team.md](Team.md) | Who owns which files, hand-offs, git workflow, integration checkpoints |
| [Architecture.md](Architecture.md) | Flow, folders, stack, **database**, **API**, module contracts |
| [Phases.md](Phases.md) | 24-hour plan per member, with gates |
| [Rules.md](Rules.md) | Boundaries for the AI and the team |
| [Design.md](Design.md) | Screens, colours, fonts |
| [Memory.md](Memory.md) | Progress log; update every session |

## Quick start
```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m pytest -q -rs
```

Run the API and app on fake data (works before any engine code exists):
```bash
set VITARAN_FAKE=1
uvicorn api.main:app --reload
```
```bash
streamlit run app/streamlit_app.py
```
API docs: http://127.0.0.1:8000/docs. In PowerShell use `$env:VITARAN_FAKE="1"`; on macOS/Linux use `export VITARAN_FAKE=1` and `source .venv/bin/activate`. `make` targets exist for the same commands.
