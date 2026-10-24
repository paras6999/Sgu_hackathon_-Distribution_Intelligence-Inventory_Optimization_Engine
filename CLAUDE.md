# CLAUDE.md

This repo is worked on by four people with different AI tools. Claude Code is used by **M2** (foundation, types, backend, core web, forecast, integration).

Read `AGENTS.md` (shared rules and commands), then `docs/team/M2-claude-lead.md`, then `docs/Memory.md`.

Claude-specific notes:
- Never push to `main`; branch `m2/<task>` and open a PR. Commit messages end with the co-author line the environment provides.
- Before editing a file, check its owner in `docs/Team.md` §2. If it belongs to M1, M3 or M4, propose the change instead of making it.
- On Windows use `bun` and `uv` from Git Bash or PowerShell; the backend starts the engine with `.venv` Python directly so it can stop it cleanly.
