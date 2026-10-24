/** Runtime settings (owner: M2). All from environment variables; see .env.example at the repo root. */
import { existsSync, readFileSync } from "node:fs";
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

/**
 * Reads KEY=VALUE lines from the repo-root `.env` into process.env without overriding variables that are already set.
 * Bun only auto-loads the `.env` of its own working directory (apps/dia-backend), not the repo root, and the task runner
 * can strip variables, so the root file is read explicitly. Secrets stay in that git-ignored file.
 */
export function loadDotEnv(file: string): number {
  if (!existsSync(file)) return 0;
  let n = 0;
  for (const raw of readFileSync(file, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");   // trailing comment on an unquoted value
    if (process.env[key] === undefined) { process.env[key] = value; n++; }
  }
  return n;
}
loadDotEnv(join(repoRoot, ".env"));

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
  /** Vertex AI (Gemini) for narration and analysis; credentials stay in the environment, never in code. */
  vertexProject: process.env.VERTEX_PROJECT,
  vertexLocation: process.env.VERTEX_LOCATION ?? "asia-south1",
  vertexModel: process.env.VERTEX_MODEL ?? "gemini-2.5-flash",
  googleCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
  vertexAccessToken: process.env.VERTEX_ACCESS_TOKEN,
  vertexApiKey: process.env.VERTEX_API_KEY,
  /** Gemini Developer API (Google AI) key: the simplest option; no project or billing setup. */
  geminiApiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL ?? "gemini-flash-latest",
};
