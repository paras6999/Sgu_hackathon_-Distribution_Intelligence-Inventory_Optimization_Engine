# Kiro.md — working on this repo in Kiro with two models

**Plan with Opus 5.5, implement with Haiku 5.5.** Opus decides *what* and *how*, in writing, in small tasks. Haiku does one task at a time and stops when the task is done or a stop rule fires. This file is the playbook; the project facts are in `docs/Handoff.md`, the work list in `docs/Backlog.md`.

Model ids (Anthropic): Opus 5.5 = `claude-opus-5-5`, Haiku 5.5 = `claude-haiku-5-5`. Pick them from Kiro's model selector. If your Kiro build names them differently, use the closest Opus-class model for planning and Haiku-class for implementation; the process does not depend on the exact names.

## 1. One-time setup

1. Open the repo folder in Kiro. Steering files in `.kiro/steering/` load automatically (`product.md`, `tech.md`, `structure.md`, `workflow.md`). They are deliberately short: they cost context on every request, so they point to files instead of repeating them.
2. Install tools and get the app running (commands in `docs/Handoff.md` §2). Do the first `bun run test` before changing anything; it must pass on a clean clone.
3. Create your local `.env` from `.env.example`. Never commit it. Leave `AI_ENABLED=false` unless you are working on the AI path.
4. Check CI on GitHub for `main` first (Backlog B01). Fix red CI before anything else.

## 2. Roles

| | Opus 5.5 (planning) | Haiku 5.5 (implementing) |
|---|---|---|
| Reads | Handoff, Backlog, PRD sections it needs, the code it will plan around | Only the task, the files the task names, and steering |
| Produces | `.kiro/specs/<id>/requirements.md`, `design.md`, `tasks.md`; reviews diffs; resolves stop-rule escalations | Code, tests and a Memory line for **one task** |
| Decides | Design, contracts, model changes, order of work | Nothing about design. If a decision is open, it stops and asks |
| Typical size | One run per backlog item (or small group) | One task: 1–3 files, about 80 changed lines, one verify command |

Opus-only items (it must write `design.md` and a human reviews it before any Haiku task starts): anything touching the optimiser model (`optimize/optimize.py`), the validator, the simulator semantics (`sim/simulate.py`), the forecaster, schema contracts, or the experiment protocol. Backlog marks these **OPUS**.

## 3. First runs (Opus 5.5)

**Run 0, gather evidence:** use the prompt in `docs/Kiro-first-prompt.md`. It tests the handoff's claims against the repo and writes `docs/Ground-truth.md`. Do this before the spec run.

**Run 1, specs:** open a new Kiro spec session with Opus 5.5 and paste this:

```
Read, in this order: AGENTS.md, docs/Ground-truth.md (where it disagrees with Handoff.md or Backlog.md, it wins), docs/Handoff.md, docs/Backlog.md, docs/Rules.md, and the .kiro/steering files.
Do not change code in this run. Create one Kiro spec per backlog item B01 to B14, in the order of the backlog (B15 to B19 are future scope: do not spec them),
under .kiro/specs/<id>-<short-name>/ with requirements.md (EARS style, each requirement testable),
design.md (files to touch, interfaces, risks, what you deliberately did not decide) and tasks.md.
Rules for tasks.md: every task is sized for a small model: it names exact file paths, touches at most 3 files and about 80 changed lines,
states the exact verify command and the expected result, leaves no design decision open, and links the requirement it satisfies.
Put a "Stop and hand back to Opus if" line on any task that touches a contract, the optimiser, the validator, the simulator or config numbers.
For items marked OPUS in the backlog, write design.md only and mark tasks "blocked: needs design review".
End with a table: item, number of tasks, risk, whether it needs a compute run (and how long).
```

Review the generated specs yourself before implementing: check that each task is small, names real files (`ls` them), and has a verify command that exists in `package.json` or the tests.

## 4. Implementation runs (Haiku 5.5)

Switch the model to Haiku 5.5. For each task, start a **fresh chat** (small models drift in long chats) and paste:

```
Implement task <spec-id> / <task-number> from .kiro/specs/<spec-id>/tasks.md and nothing else.
Read AGENTS.md rules, the task, and only the files it names. Follow .kiro/steering/workflow.md.
Write or update the tests first when the task adds behaviour. Run the verify command from the task and show me its output.
If any stop rule fires, or the verify command fails twice for a reason you cannot explain, stop and write what you found; do not work around it.
When it passes: add one line to docs/Memory.md, then commit with a message that says what and why.
```

Then run `bun run test` yourself before pushing. Push small commits to `main` (direct pushes are allowed; never force-push). CI runs on every push.

### Stop rules for Haiku (hand back to Opus)
Stop and escalate when a task would: change a JSON Schema, `store.TABLES`, a route signature or a function signature listed in the task; edit `optimize.py`, `validate.py`, `pipeline.py`, `simulate.py`, `forecast.py`, `generate.py` or any number in `config.yaml`; add a dependency; touch more than 3 files; need a secret; require deleting data or history; or fail the same test twice.

## 5. Task and spec templates

Use this shape (Opus fills it in; this is also a complete worked example for Backlog B12):

**requirements.md**
```
# B12 Unit tests for pure web functions
## Requirements
1. WHEN `fmt`, `fmtDelta`, `inr`, `targetFor` or `ci` in apps/dia-web/src/pages/AnalyticsPages.tsx receive a value, THE SYSTEM SHALL return the formatted string defined in the table in design.md.
2. WHEN `bun run test` runs, THE SYSTEM SHALL execute the web unit tests.
```
**design.md**: export the pure helpers from a new `apps/dia-web/src/lib/format.ts` (move code, no behaviour change); test with `bun test` (already available); table of 8 input/output pairs; risk: none; not decided: a browser test runner.
**tasks.md**
```
- [ ] 1. Move fmt, fmtDelta, inr, ci to apps/dia-web/src/lib/format.ts and import them in AnalyticsPages.tsx.
      Files: apps/dia-web/src/lib/format.ts (new), apps/dia-web/src/pages/AnalyticsPages.tsx.
      Verify: bun run --cwd apps/dia-web typecheck  -> no output.
- [ ] 2. Add apps/dia-web/src/lib/format.test.ts with the 8 cases from design.md.
      Verify: bun test apps/dia-web/src/lib -> 8 pass.
- [ ] 3. Add "test": "bun test src/lib" to apps/dia-web/package.json scripts.
      Verify: bun run test -> includes the web tests, all green.
      Stop and hand back to Opus if: the move changes any rendered text.
```

## 6. Review checklist (for you, after each Haiku task)

- Diff is limited to the files the task names. Tests were added for new behaviour and fail without the change.
- No `.value` on enum-typed fields from requests (see Handoff §7); no raw hex colours in components (use `theme.css` tokens); no new inline styles for layout.
- No number invented: every business figure comes from `config.yaml`; every claim in docs traces to a file or a run.
- For UI: open it (`bun run dev`), light and dark, one narrow window. For anything that changes numbers: re-run the relevant tests and note the before and after in `docs/Memory.md`.
- `git status` shows no `.env`, `data/`, videos or keys.

## 7. Cheat sheet

```bash
bun run test                  # everything (types, backend, engine), about 2 min
bun run test:engine           # engine only
bun test apps/dia-backend     # backend only
bun run typecheck             # all TypeScript
bun run gen:types             # after editing packages/dia-types/schema/*.json
bun run --cwd apps/dia-web build
uv run --package dia-engine pytest engine/dia-engine/tests/test_service.py -q   # one engine file
bun run dev | bun run dev:fake
```
Ports: web 3000, backend 8000 (docs at `/docs`), engine 7010. Data: `data/engine` (parquet, git-ignored), `data/backend` (SQLite, git-ignored).
