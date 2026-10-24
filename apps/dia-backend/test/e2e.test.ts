/**
 * End-to-end: backend + REAL engine process (ENGINE_MODE=source). Opt-in: E2E=1 (CI runs it).
 * Generates seed01 into a temp dir, starts `uv run dia-engine serve`, and checks the two connect.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const enabled = process.env.E2E === "1";
const dataDir = mkdtempSync(join(tmpdir(), "dia-e2e-"));
process.env.DIA_DATA_DIR = dataDir;
process.env.ENGINE_PORT = process.env.ENGINE_PORT ?? "7311";

const { env, repoRoot } = await import("../src/env");
const { createApp } = await import("../src/app");
const { Repo } = await import("../src/db/repo");
const { HttpEngine } = await import("../src/engine/http");

let engine: InstanceType<typeof HttpEngine>;
let app: ReturnType<typeof createApp>;

describe.if(enabled)("backend + engine (source mode)", () => {
  beforeAll(async () => {
    const gen = Bun.spawnSync(["uv", "run", "--quiet", "--package", "dia-engine", "dia-engine", "generate", "--seed", "1"], {
      cwd: repoRoot, env: { ...process.env, DIA_DATA_DIR: env.engineDataDir }, stdout: "inherit", stderr: "inherit",
    });
    expect(gen.exitCode).toBe(0);
    engine = new HttpEngine("source");
    app = createApp({ repo: new Repo(":memory:"), engine });
  }, 300_000);

  afterAll(async () => { await engine?.close(); });

  test("health shows a live engine", async () => {
    const h = (await (await app.request("/v1/health")).json()) as { engine: string; engine_mode: string };
    expect(h).toMatchObject({ engine: "ok", engine_mode: "source" });
  }, 180_000);

  test("scenarios and assumptions come from the engine", async () => {
    expect(await (await app.request("/v1/scenarios")).json()).toEqual(["seed01"]);
    const rows = (await (await app.request("/v1/assumptions")).json()) as Array<{ parameter: string }>;
    expect(rows.some((r) => r.parameter === "costs.diesel_inr_per_l")).toBe(true);
  });

  test("POST /v1/plans returns a validated plan with a reason on every line", async () => {
    const r = await app.request("/v1/plans", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario_id: "seed01", as_of: "2025-09-29", temp_class: "chilled" }),
    });
    expect(r.status).toBe(200);
    const plan = (await r.json()) as { lines: Array<{ reasons: unknown[] }>; trucks: unknown[] };
    expect(plan.lines.length).toBeGreaterThan(0);
    expect(plan.trucks.length).toBeGreaterThan(0);
    expect(plan.lines.every((l) => l.reasons.length >= 1)).toBe(true);
  }, 120_000);
});
