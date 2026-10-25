# Kiro-first-prompt.md — Run 0: gather evidence before planning

Use this **before** the spec run in `docs/Kiro.md` §3. Model: **Opus 5.5**. Time: about 30 to 45 minutes, mostly waiting for commands. It changes no code. It produces one file, `docs/Ground-truth.md`, that says which statements in the handoff are **confirmed, different, or unverified**, with the command output or the file and line as evidence. The spec run then plans from that file.

Why: the handoff was written by the person who built the project, partly from memory of a long session. A new owner should not plan on top of unverified claims. Run 0 turns each claim into an observation.

## How to use it
1. Clone the repo, open it in Kiro, select Opus 5.5, start a **new chat** (not a spec session).
2. Paste the prompt below. It is self-contained.
3. When it finishes, read `docs/Ground-truth.md` yourself, answer its "Questions for the owner", commit it, then continue with `docs/Kiro.md` §3.

## The prompt (copy everything inside the box)

```
ROLE
You are the technical lead taking over the Vitaran (DIAgent) repo from its builder. Before any planning you must establish, from evidence,
what is actually true. You do not trust the handoff documents; you test them. Do not change any code, config, schema or test in this run.
The only file you may create or edit is docs/Ground-truth.md.

CONTEXT TO LOAD FIRST (in this order; note anything that contradicts something earlier)
1. AGENTS.md, then .kiro/steering/*.md
2. docs/Handoff.md (the claims to verify), docs/Backlog.md, docs/Rules.md
3. docs/Memory.md: read the top 80 lines only (newest first), then search it for "Open" and "Open issues"
4. docs/Architecture.md sections 1, 2, 6, 7 and 8; docs/Demo.md "Numbers to quote"
5. docs/PRD.md: only sections 2.4, 6.6.3, 6.6.5, 8.1 and 8.2 (it is long; do not read it all)

RULES FOR EVIDENCE
- Every finding needs evidence: the exact command and the key lines of its output, or file:line from the code. No evidence means status UNVERIFIED.
- Never write a number from memory or from the docs as if you had measured it. If you re-state a documented number, say whether you reproduced it.
- If a command cannot run (no network, no GitHub access, missing tool, too slow), say so, say what you ran instead, and mark the claim UNVERIFIED.
- Do not print, log or paste any secret. There is a .env file in the repo root that may hold a key; do not open it. Use `.env.example` for variable names.
- Time-box: do not start the 1-hour experiment re-run. Everything else is in scope.

STEP 1 - ENVIRONMENT (run, record output)
  bun --version ; uv --version ; git log --oneline -5 ; git status --short
  bun run setup
STEP 2 - TESTS AND BUILD (run, record the pass/fail counts)
  bun run typecheck
  bun run test
  bun run --cwd apps/dia-web build
  Expected from the handoff: types about 8 pass, backend about 33 pass (6 skipped = opt-in e2e), engine about 157 pass and 2 expected failures (strict xfail, documented in docs/Memory.md). Report the real counts and any failures with their first error lines.
STEP 3 - DATA AND ENGINE (run; needs network once for weather)
  uv run --package dia-engine dia-engine weather --fetch
  uv run --package dia-engine dia-engine generate --seeds 3          (3 is enough for this run)
  Then start the stack with `bun run dev` in a BACKGROUND terminal (it never exits; wait for "dia-backend on http://localhost:8000" and an engine health of ok), and, with curl against http://localhost:8000:
  - GET /v1/health, GET /v1/ai/status (expect rules mode unless a key is set)
  - POST /v1/plans with {"scenario_id":"seed01","as_of":"2025-09-29","temp_class":"ambient"} and again with "chilled"
    Record: number of lines and trucks, solve.status, solve.seconds, expected_kpis, and whether every line has at least one reason.
  - POST /v1/forecasts with {"scenario_id":"seed01","as_of":"2025-09-29"}: record the metrics (handoff: WAPE 0.146, naive 0.293, bias -0.006, coverage 0.799).
  - GET /v1/scenarios/seed01/history and /effects: record counts.
  - POST /v1/ai/analyse for the plan you just made: record source and verified.
STEP 4 - CLAIMS TO VERIFY (one row each in the report)
  C1  The public API has 25 routes (apps/dia-backend/src/openapi.ts ROUTES; test/journey.test.ts). The newest routes (at-risk, trajectory, what_if on POST /v1/plans) were added by a second team member; check them too.
  C2  Config values: costs.stockout_penalty_x_margin 2.4; network.alt_depot_max_km 600; network.chilled_max_km 600; costs.ftl.REEF17 kg 1500. (packages/dia-config/config.yaml)
  C3  Plant receipts land before dispatch in run_policy; the depot write-off applies to every lot (engine/dia-engine/src/dia_engine/sim/simulate.py, optimize/optimize.py).
  C4  The optimiser caps the search at 1.5 s (MIP_BUDGET_S) and the simulator at 1.0 s (SIM_TIME_LIMIT_S); the ambient plan status is time_limit.
  C5  Every engine plan is validated before return (optimize/pipeline.py make_plan). docs/Rules.md says nobody but make_plan calls optimize, explain or validate; search the repo for imports of them. Expected: sim/simulate.py also calls validate directly, on baseline plans that do not go through make_plan. Report whether that is a rule violation or a sensible exception, and what you would change.
  C6  Quantities never come from the AI layer: read apps/dia-backend/src/ai/ and confirm the model receives only computed facts and the output is only text.
  C7  Reason code FAIR_SHARE_FLOOR is never emitted (explain.py); the other ten are each covered by a test (tests/test_explain.py).
  C8  Real weather is used when data/engine/weather_daily.parquet exists; the synthetic fallback otherwise (data/weather.py). Which one is in use in your clone?
  C9  The result of record in docs/Demo.md (cost -15%, wastage -72/-82%, freight/case -20/-19%, CO2 -22%, fill rate -0.4/-0.8 points) comes from a stored experiment EX-de4798536119 that is NOT in git. State whether you can reproduce it from this repo alone and how long the run would take (do not run it).
  C10 CI: .github/workflows/ci.yml defines five jobs. Check the latest run on main in GitHub (or ask the owner to paste it). Record each job's result; for a red job reproduce it locally and give the first error.
  C11 The nine "Known gaps" in docs/Handoff.md section 6: for each, point to the code or data that shows it is real (file:line or numbers), or say it could not be confirmed.
  C12 Secrets: git ls-files must not contain .env, data/, keys; search the git history for key-like strings ("AQ.", "AIza", "BEGIN PRIVATE KEY") and report only whether any exist, never the value.
STEP 5 - READ THE CODE FOR THE FIRST TWO DESIGN ITEMS
  For Backlog B05 (lost-sales window and lead time) and B10 (solve time) answer from the code, with file:line:
  where the lost-sales curves and the window are built; how lead time enters; where model build time goes (profile one ambient solve with cProfile or timers; report seconds by stage).
  Do not propose a design yet; collect the facts a design needs.
STEP 6 - WRITE docs/Ground-truth.md WITH THESE SECTIONS
  1. Summary in 10 lines: what works, what does not, what is unverified, the three biggest risks.
  2. Environment and command log: the commands you ran and the key lines of output (trim noise; keep counts and errors).
  3. Claim table: ID | claim | how verified | result | evidence | status (CONFIRMED / DIFFERS / UNVERIFIED).
  4. Discrepancies: every place the docs and the repo disagree, with the file and the line to fix.
  5. Facts for B05 and B10 (from step 5).
  6. Backlog adjustments: items to reorder, split or drop, each with the evidence that justifies it.
  7. Questions for the owner: decisions only a human can make (key rotation, GitHub access, whether to keep dia-fallback-ui, compute budget for experiments).
END of run: print the summary section and the list of UNVERIFIED and DIFFERS items. Then stop and wait; do not create specs.
```

## What good output looks like
- Every row has a command or a `file:line`, and the numbers are the ones the run printed.
- At least a few rows say DIFFERS or UNVERIFIED. If everything is CONFIRMED, the run was probably too trusting; ask it to re-check C4, C9, C10 and C11 with evidence.
- Section 4 (discrepancies) is short and specific. Section 7 has real questions.

## After Run 0
Commit `docs/Ground-truth.md`, fix the discrepancies it lists (a Haiku-sized job), then run the spec prompt in `docs/Kiro.md` §3. In that prompt, add one line at the start: *"Also read docs/Ground-truth.md first; where it disagrees with Handoff.md or Backlog.md, it wins."*
