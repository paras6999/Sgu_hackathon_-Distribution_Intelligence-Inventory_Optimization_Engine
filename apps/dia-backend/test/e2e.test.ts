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
  test("a trim in the inbox does a real re-solve (FR-08)", async () => {
    const post = (path: string, body: unknown) => app.request(path, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const plan = (await (await post("/v1/plans", { scenario_id: "seed01", as_of: "2025-09-29", temp_class: "ambient" })).json()) as
      { plan_id: string; version: number; lines: Array<{ line_id: string; to_id: string; cases: number }> };
    expect((await post(`/v1/plans/${plan.plan_id}/publish`, { version: plan.version })).status).toBe(200);
    const line = plan.lines.find((l) => l.cases >= 4)!;
    const t0 = performance.now();
    const r = await post(`/v1/plans/${plan.plan_id}/responses`, {
      dist_id: line.to_id, proposal_version: 1, actions: [{ line_id: line.line_id, action: "trim", qty: Math.floor(line.cases / 2) }] });
    const secs = (performance.now() - t0) / 1000;
    expect(r.status).toBe(200);
    const res = (await r.json()) as { plan_version: number; line_diff: Array<{ dist_id: string; old_cases: number; new_cases: number }> };
    expect(res.plan_version).toBe(plan.version + 1);
    // nobody who has not answered shrinks
    expect(res.line_diff.filter((d) => d.dist_id !== line.to_id).every((d) => d.new_cases >= d.old_cases)).toBe(true);
    console.log(`re-solve through the API: ${secs.toFixed(1)} s`);
    // a stale version for the same distributor is refused
    const stale = await post(`/v1/plans/${plan.plan_id}/responses`, { dist_id: line.to_id, proposal_version: 0, actions: [] });
    expect(stale.status).toBe(409);
  }, 240_000);
});
