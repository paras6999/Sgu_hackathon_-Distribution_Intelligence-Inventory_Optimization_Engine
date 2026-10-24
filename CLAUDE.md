# CLAUDE.md

Solo project: @paras6999 builds everything with Claude Code.

Read `AGENTS.md` (rules and commands), then `docs/Memory.md`, then the next task in `docs/Phases.md`.

Claude-specific notes:
- Small, safe changes may go straight to `main`; large or risky ones (the MILP, the simulator) go on a branch with a PR so CI runs first, then squash-merge. Commit messages end with the co-author line the environment provides.
- Keep the module boundaries and contracts in `docs/Architecture.md`; a contract change updates fixtures and tests in the same commit.
- On Windows use `bun` and `uv` from Git Bash or PowerShell; the backend starts the engine with `.venv` Python directly so it can stop it cleanly.
