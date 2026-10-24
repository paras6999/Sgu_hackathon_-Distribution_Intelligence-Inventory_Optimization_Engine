/** Runtime settings (owner: M2). All from environment variables; see .env.example at the repo root. */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type EngineMode = "fake" | "source" | "binary";

function findRepoRoot(): string {
  let dir = resolve(import.meta.dir);
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "packages", "dia-config"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export const repoRoot = findRepoRoot();

export const env = {
  port: Number(process.env.PORT ?? 8000),
  /** fake: fixtures, no engine process. source: `uv run dia-engine serve`. binary: the built dia-engine. */
  engineMode: (process.env.ENGINE_MODE ?? "source") as EngineMode,
  enginePort: Number(process.env.ENGINE_PORT ?? 7010),
  /** Attach to an engine that is already running instead of starting one. */
  engineUrl: process.env.ENGINE_URL,
  engineBin: process.env.ENGINE_BIN ?? join(repoRoot, "dist", "dia-engine", "dia-engine"),
  backendDataDir: process.env.DIA_BACKEND_DATA_DIR ?? join(repoRoot, "data", "backend"),
  engineDataDir: process.env.DIA_DATA_DIR ?? join(repoRoot, "data", "engine"),
  aiEnabled: process.env.AI_ENABLED === "true",
};
