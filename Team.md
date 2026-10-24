# Team.md — Work split for a team of 4

Goal: four people work **in parallel without waiting on each other**, and the parts **join without surprises** at the end. Three things make that work:

1. **Frozen contracts.** `engine/models.py` (data shapes), `engine/store.py` (tables and columns), the function signatures in every `engine/*.py` stub and the API paths in `api/main.py` are fixed from hour 0.
2. **Fakes.** `engine/fakes.py` has a valid, small example of every object. Until your upstream teammate delivers, you build against the fake. When their real code lands, you change nothing.
3. **Contract tests in CI.** `tests/test_contracts.py` calls each real function on fake inputs and checks the output type. A PR that breaks a contract turns CI red before it reaches `main`.

Fill in names here:

| Member | Name | Role |
|---|---|---|
| **A** | _______ | Data & Simulation |
| **B** | _______ | Forecasting & Targets |
| **C** | _______ | Optimisation & Explanations |
| **D** | _______ | API, Database & UI |

---

## 1. Ownership (one owner per file, so there are no merge conflicts)

| Member | Owns these files | PRD requirements | Good fit for |
|---|---|---|---|
| **A · Data & Simulation** | `config/config.yaml`, `engine/config.py`, `engine/generate.py`, `engine/weather.py`, `engine/simulate.py`, `engine/kpi.py`, `engine/baseline_b.py`, `scripts/run_experiments.py` | FR-01, FR-02, FR-09, FR-10 (B), FR-12 runs, FR-15 content, §8 KPIs | pandas, numpy, simulation logic |
| **B · Forecasting & Targets** | `engine/forecast.py`, `engine/dist.py`, `engine/targets.py`, `engine/baseline_a.py` | FR-03, FR-04, FR-10 (A), ablation (c), backtest report | statistics, time series |
| **C · Optimisation & Explanations** | `engine/optimize.py`, `engine/freight.py`, `engine/validate.py`, `engine/explain.py`, `engine/pipeline.py` | FR-05, FR-06, FR-07 load build, FR-08 re-solve, ablations (a)(b)(d)(e)(f) | linear programming, PuLP |
| **D · API, Database & UI** | `engine/store.py`, `api/main.py`, `api/backend.py`, `app/streamlit_app.py`, `Makefile`, `.github/` | FR-07 views, FR-08 inbox, FR-11, FR-14, FR-15 screen, FR-16 | FastAPI, Streamlit, SQL |

**Shared contract files** (no single owner; change only by contract-change PR, §4): `engine/models.py`, `engine/fakes.py`, `engine/policy.py`, `tests/test_contracts.py`, `store.TABLES`.

Reviewers: every PR gets one review from the member who **consumes** that output (table in §2). The validator (`validate.py`) is written by C and reviewed by A, so the constraint checker has a second pair of eyes.

---

## 2. Hand-offs: who gives what to whom

| # | Producer → Consumer | What crosses the boundary | Contract | Until it lands, consumer uses |
|---|---|---|---|---|
| H1 | A → B | Scenario parquet: `demand_daily`, `events`, `weather_daily` | `store.TABLES` columns | B writes a 50-line toy generator in a test, or uses the fake forecast |
| H2 | A → C, D | `Scenario`, `Snapshot` | `models.Scenario`, `models.Snapshot` | `fakes.fake_scenario()`, `fakes.fake_snapshot()` |
| H3 | B → C | Daily demand mean/var per pair | `models.ForecastBundle`, `dist.window()` | `fakes.fake_forecast()` |
| H4 | B → C | Target levels S | `models.Target` | `fakes.fake_targets()` |
| H5 | B → C | Partial expectations for curves C2, C8 | `dist.expected_shortfall()`, `dist.expected_leftover()`, `dist.quantile()` | C temporarily uses a normal approximation locally; switches to B's functions when merged |
| H6 | C → A, B | Freight cost + load build | `freight.ftl_trip_cost / ptl_cost / build_loads` | Baselines compute freight with a simple copy of the formula until C merges |
| H7 | C → A, D | Validated plan with reasons | `pipeline.make_plan() → models.Plan` | `fakes.fake_plan()`; FakeBackend in the API |
| H8 | C → D | Locked re-solve after a distributor response | `pipeline.apply_response() → Plan` | FakeBackend applies the trim directly |
| H9 | A, B → A | Policies for the simulator | `policy.Policy.plan() → Plan` | A's simulator first runs with a "fake policy" returning `fake_plan()` |
| H10 | A → D | Experiment results | `store.save_results(ExperimentResults)` | `fakes.fake_results()` via FakeBackend |
| H11 | D → all | Storage | `store.write_table / read_table / save_plan …` | Already implemented |

**Golden rule:** if you need a field that isn't in the contract, don't work around it — open a contract-change PR (§4). It takes 10 minutes and saves hours at integration.

---

## 3. Daily workflow

```bash
git clone https://github.com/paras6999/Sgu_hackathon_-Distribution_Intelligence-Inventory_Optimization_Engine.git
cd Sgu_hackathon_-Distribution_Intelligence-Inventory_Optimization_Engine
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python -m pytest -q -rs          # green, with skips for unbuilt modules
```

1. Branch from `main`: `a/generator`, `b/forecast`, `c/optimizer`, `d/inbox-ui` (prefix = your letter).
2. Replace the `raise NotImplementedError` in **your** files. Do not change a function signature.
3. Run `python -m pytest -q -rs`. Your module's contract test stops being skipped and must pass.
4. Push, open a PR into `main`, wait for green CI plus one review from your consumer, then merge (squash).
5. Pull `main` at least every 3 hours.
6. At the end of your session, add a line under your name in `Memory.md`.

Never commit to `main` directly. Never edit a file another member owns; ask them, or open a PR they review.

---

## 4. Changing a contract

Contracts: `engine/models.py`, `store.TABLES`, function signatures, API paths, `KPI_NAMES`, `POLICY_SETTINGS` names.

| Change | Allowed? | Process |
|---|---|---|
| Add an **optional** field with a default | Yes | PR titled `contract: …`, review by one consumer |
| Add a new table / endpoint / function | Yes | Same, plus update `fakes.py` and `tests/test_contracts.py` |
| Rename or remove a field, change a type, change a signature | Only if unavoidable | PR titled `contract!: …`, approved by **every** consumer, announced in the team chat |

Every contract PR must update `fakes.py` so the fakes stay valid, and must keep `tests/test_contracts.py` green.

---

## 5. Integration checkpoints

| Hour | Checkpoint | What must be true | Owner of the check |
|---|---|---|---|
| **0** | Contract freeze | Everyone has run the tests green on their laptop; names filled in above; branches created | D |
| **3** | First merges | A: `generate` writes `seed01` tables. B: `dist.py` functions pass. C: `freight.py` + validator pass on `fake_plan()`. D: UI runs against `make api-fake` | each |
| **6** | Real data flows | `forecast("seed01", …)` runs on A's real data. `optimize.solve(fake_optimize_input())` returns a valid plan. API in real mode returns a real scenario and snapshot | B, C |
| **9** | Pipeline joined | `POST /v1/plans` in real mode returns a real, validated plan with reason codes. The simulator runs Engine for 7 days on seed01 | C, A |
| **12** | **PRD gate** | One seed × 84 days, Engine + both baselines: 0 validator violations, 0 conservation failures, every line coded. 3-seed smoke run gives timings and baseline KPI levels. Targets frozen | A (runs), all |
| **15** | Demo tier joined | Inbox trim → real locked re-solve; full experiment running in the background | C, D |
| **18** | **Scope freeze** | Every demo screen loads from cache in real mode. `VITARAN_FAKE` unset everywhere | D |

At each checkpoint: 10-minute stand-up, everyone pulls `main`, D runs the API journey test in real mode (`pytest -k api_journey` with `VITARAN_FAKE` unset once all parts exist), and anything red is fixed before new features.

---

## 6. Definition of done per member

| Member | Done when |
|---|---|
| A | `make data` builds 20 seeds reproducibly (same hash twice); Baseline B passes its contract test; `run_experiment` writes all tables and `results.json`; conservation assertion has 0 failures; every `config.yaml` parameter has an `assumptions` entry |
| B | Forecast for 384 pairs ≤ 30 s refit / ≤ 3 s update; backtest WAPE, bias and coverage reported vs seasonal naive; `dist` curves within 2% of Monte Carlo; Baseline A passes its contract test |
| C | `test_optimizer_output_is_valid` passes on fakes and real data; p95 ambient solve ≤ 2 s; every line has a reason code; counterfactual check ≥ 90%; `apply_response` never shrinks an unresponded distributor |
| D | API journey test passes in real mode; every screen in `Design.md` loads ≤ 3 s from cache; 409 path demonstrated; CSV opens in Excel without fixes |

---

## 7. If someone falls behind

Apply the PRD drop order (§5.1) first. Then rebalance by **file**, not by sharing a file: e.g. D takes `kpi.py` from A, or B takes `explain.py` templates from C. The new owner is written into §1 and `Memory.md` so the AI tools also know.
