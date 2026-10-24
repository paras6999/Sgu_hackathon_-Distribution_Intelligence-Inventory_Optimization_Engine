/** dia-backend entry point (owner: M2). `bun src/index.ts` in dev; `bun build --compile` for the binary (M1). */
import { join } from "node:path";
import { createApp } from "./app";
import { Repo } from "./db/repo";
import type { EngineClient } from "./engine/client";
import { FakeEngine } from "./engine/fake";
import { HttpEngine } from "./engine/http";
import { env } from "./env";

const engine: EngineClient = env.engineMode === "fake" ? new FakeEngine() : new HttpEngine(env.engineMode);
const repo = new Repo(join(env.backendDataDir, "vitaran.db"));
const app = createApp({ repo, engine });

const server = Bun.serve({ port: env.port, fetch: app.fetch, idleTimeout: 120 });
console.log(`dia-backend on http://localhost:${server.port}  (engine: ${env.engineMode}, docs: /docs)`);

async function shutdown() {
  server.stop();
  await engine.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
