---
inclusion: always
---
# Workflow: two models, two jobs

Playbook: `docs/Kiro.md`. Work list: `docs/Backlog.md`. Project facts: `docs/Handoff.md`.

**Opus 5.5 plans.** Writes `.kiro/specs/<id>/requirements.md`, `design.md`, `tasks.md`. Every task: exact file paths, at most 3 files and about 80 changed lines, an exact verify command with the expected result, no open design decision, a "Stop and hand back to Opus if" line when it touches a contract, the optimiser, the validator, the simulator, the forecaster or a config number. Backlog items marked OPUS get a `design.md` and wait for human review.

**Haiku 5.5 implements one task per chat.** Read the task and only the files it names. Tests first when behaviour is added. Run the verify command and show the output. Then one line in `docs/Memory.md` and a commit that says what and why.

**Stop and hand back to Opus** when a task would: change a JSON Schema, `store.TABLES`, a route or listed function signature; edit `optimize.py`, `validate.py`, `pipeline.py`, `simulate.py`, `forecast.py`, `generate.py` or any `config.yaml` number; add a dependency; touch more than 3 files; need a secret; delete data or history; or fail the same test twice. Write what you found; do not work around it.

**Never:** force-push `main`; commit `.env`, `data/`, `.venv`, `node_modules`, keys or videos; invent a figure, source or citation; claim something works without running it; weaken a test to make it pass; return a plan that did not go through the validator; let a model or the AI layer set a quantity.

**Done means:** `bun run test` and `bun run typecheck` pass; web changes also build and were looked at in the browser, light and dark; contract changes are in one commit with fixtures and tests; Memory line added.
