/**
 * HttpEngine (owner: M2; process management with M1): talks to the dia-engine internal service.
 *
 * source mode: starts `uv run --package dia-engine dia-engine serve` from the repo root.
 * binary mode: starts the built `dia-engine serve` executable (ENGINE_BIN).
 * ENGINE_URL set: attaches to an engine that is already running and starts nothing.
 * Experiments run as a separate one-shot process (`dia-engine experiment`) that reports PROGRESS lines.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  AssumptionRow, BacktestMetrics, DemandHistory, EngineForecastRequest, EngineHealth, EnginePlanRequest, EngineResolveRequest,
  ExperimentRequest, ExperimentResults, ForecastBundle, LearnedEffects, OpeningState, Plan, Scenario, Snapshot,
} from "@dia/types";
import { env, repoRoot } from "../env";
import { EngineError, type EngineClient, type ExperimentOutcome } from "./client";

/** source: the workspace venv's Python directly (one process, so it can be stopped cleanly); uv as fallback. */
function engineCommand(mode: "source" | "binary"): string[] {
  if (mode === "binary") return [env.engineBin];
  const py = process.platform === "win32" ? join(repoRoot, ".venv", "Scripts", "python.exe") : join(repoRoot, ".venv", "bin", "python");
  return existsSync(py) ? [py, "-m", "dia_engine.cli"] : ["uv", "run", "--quiet", "--package", "dia-engine", "dia-engine"];
}

/** Stop a process and its children (Windows does not kill child processes with the parent). */
async function stopTree(proc: ReturnType<typeof Bun.spawn>): Promise<void> {
  if (proc.exitCode !== null) return;
  if (process.platform === "win32") Bun.spawnSync(["taskkill", "/PID", String(proc.pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" });
  else proc.kill();
  await proc.exited;
}

export class HttpEngine implements EngineClient {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private ready: Promise<void>;
  readonly baseUrl: string;

  constructor(readonly mode: "source" | "binary") {
    this.baseUrl = env.engineUrl ?? `http://127.0.0.1:${env.enginePort}`;
    this.ready = env.engineUrl ? Promise.resolve() : this.start();
  }

  private async start(): Promise<void> {
    const childEnv = { ...process.env, DIA_DATA_DIR: env.engineDataDir };
    this.proc = Bun.spawn([...engineCommand(this.mode), "serve", "--port", String(env.enginePort)], {
      cwd: repoRoot, env: childEnv, stdout: "inherit", stderr: "inherit",
    });
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${this.baseUrl}/health`);
        if (r.ok) return;
      } catch { /* not up yet */ }
      if (this.proc.exitCode !== null) throw new Error(`dia-engine exited with code ${this.proc.exitCode}`);
      await Bun.sleep(500);
    }
    throw new Error("dia-engine did not become healthy within 120 s");
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    await this.ready;
    const r = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({ detail: r.statusText }));
    if (!r.ok) throw new EngineError(r.status, data);
    return data as T;
  }

  health() { return this.call<EngineHealth>("GET", "/health"); }
  scenarios() { return this.call<string[]>("GET", "/scenarios"); }
  scenario(id: string) { return this.call<Scenario>("GET", `/scenarios/${encodeURIComponent(id)}`); }
  snapshot(id: string, asOf: string, openingState: OpeningState) {
    const q = new URLSearchParams({ as_of: asOf, opening_state: openingState });
    return this.call<Snapshot>("GET", `/scenarios/${encodeURIComponent(id)}/snapshot?${q}`);
  }
  forecast(req: EngineForecastRequest) { return this.call<ForecastBundle>("POST", "/forecast", req); }
  backtest(id: string) { return this.call<BacktestMetrics>("GET", `/scenarios/${encodeURIComponent(id)}/backtest`); }
  history(id: string, distId?: string, skuId?: string) {
    const q = new URLSearchParams();
    if (distId) q.set("dist_id", distId);
    if (skuId) q.set("sku_id", skuId);
    return this.call<DemandHistory>("GET", `/scenarios/${encodeURIComponent(id)}/history?${q}`);
  }
  effects(id: string) { return this.call<LearnedEffects>("GET", `/scenarios/${encodeURIComponent(id)}/effects`); }
  plan(req: EnginePlanRequest) { return this.call<Plan>("POST", "/plan", req); }
  resolve(req: EngineResolveRequest) { return this.call<Plan>("POST", "/resolve", req); }
  assumptions() { return this.call<AssumptionRow[]>("GET", "/assumptions"); }

  async runExperiment(id: string, req: ExperimentRequest, onProgress: (pct: number) => void): Promise<ExperimentOutcome> {
    const dir = join(tmpdir(), "dia-experiments");
    mkdirSync(dir, { recursive: true });
    const reqPath = join(dir, `${id}.json`);
    writeFileSync(reqPath, JSON.stringify(req));
    const proc = Bun.spawn([...engineCommand(this.mode), "experiment", "--id", id, "--request", reqPath], {
      cwd: repoRoot, env: { ...process.env, DIA_DATA_DIR: env.engineDataDir }, stdout: "pipe", stderr: "pipe",
    });
    let last = "";
    const decoder = new TextDecoder();
    for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
      for (const line of decoder.decode(chunk).split(/\r?\n/)) {
        if (line.startsWith("PROGRESS ")) onProgress(Number(line.slice(9)));
        if (line.trim()) last = line.trim();
      }
    }
    const code = await proc.exited;
    if (code === 0) return { status: "done" };
    const stderr = await new Response(proc.stderr as ReadableStream).text();
    return { status: "failed", error: last.startsWith("NOT_IMPLEMENTED") ? last : `${last}\n${stderr.slice(-2000)}` };
  }

  async experimentResults(id: string): Promise<ExperimentResults | null> {
    const path = join(env.engineDataDir, "experiments", id, "results.json");
    return existsSync(path) ? ((await Bun.file(path).json()) as ExperimentResults) : null;
  }

  async close(): Promise<void> {
    if (this.proc) await stopTree(this.proc);
  }
}
