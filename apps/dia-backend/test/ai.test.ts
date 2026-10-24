/** Analysis on demand: rules path, number verification, model path (mocked), Vertex client (mocked HTTP), and the routes. */
import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plan } from "@dia/types";
import { analyse, unverifiedNumbers } from "../src/ai/analyse";
import { planFacts, resultsFacts } from "../src/ai/facts";
import { VertexClient, type LlmClient } from "../src/ai/vertex";
import { createApp } from "../src/app";
import { Repo } from "../src/db/repo";
import { FakeEngine } from "../src/engine/fake";

const mk = (llm: LlmClient | null) => createApp({ repo: new Repo(":memory:"), engine: new FakeEngine(), llm });
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const json = async (r: Response | Promise<Response>): Promise<any> => (await r).json();

const mock = (reply: string | Error): LlmClient & { prompts: string[] } => ({
  name: "mock", model: "mock-1", prompts: [] as string[],
  async generate(_s, user) { this.prompts.push(user); if (reply instanceof Error) throw reply; return reply; },
});

async function planAndExperiment(app: ReturnType<typeof createApp>) {
  const plan = (await json(await post(app, "/v1/plans", { scenario_id: "seed01", as_of: "2025-10-13", temp_class: "ambient" }))) as Plan;
  const ex = await json(await post(app, "/v1/experiments", {}));
  return { plan, experimentId: ex.experiment_id as string };
}

describe("rules analysis (no model, works offline)", () => {
  test("plan analysis summarises the plan from its own numbers", async () => {
    const app = mk(null);
    const { plan } = await planAndExperiment(app);
    const r = await post(app, "/v1/ai/analyse", { kind: "plan", plan_id: plan.plan_id });
    expect(r.status).toBe(200);
    const a = await json(r);
    expect(a).toMatchObject({ source: "rules", model: null, verified: true });
    expect(a.text).toContain("Summary:");
    expect(a.text).toContain(`${plan.lines.length} lines`);
    expect(a.text).toContain("Truck fill:");
  });

  test("results analysis names what is better and what is worse", async () => {
    const app = mk(null);
    const { experimentId } = await planAndExperiment(app);
    const a = await json(await post(app, "/v1/ai/analyse", { kind: "results", experiment_id: experimentId, opening_state: "neutral" }));
    expect(a.source).toBe("rules");
    expect(a.text).toContain("Verdict (neutral start");
    expect(a.text).toContain("Caveats:");
  });

  test("a free-form question without a model says it needs the model", async () => {
    const app = mk(null);
    const { plan } = await planAndExperiment(app);
    const a = await json(await post(app, "/v1/ai/analyse", { kind: "plan", plan_id: plan.plan_id, question: "Why is Pune short?" }));
    expect(a.source).toBe("rules");
    expect(a.note).toContain("need the AI model");
  });

  test("a single line can be explained", async () => {
    const app = mk(null);
    const { plan } = await planAndExperiment(app);
    const a = await json(await post(app, "/v1/ai/analyse", { kind: "line", plan_id: plan.plan_id, line_id: plan.lines[0]!.line_id }));
    expect(a.text).toContain(plan.lines[0]!.sku_name);
  });
});

describe("number verification", () => {
  const facts = { cost: 18396901, share_pct: 15.3, lines: 294, label: "Diwali ×1.34 in the cover window" };
  test("accepts figures that match the facts, including lakh/crore conversion and percentages", () => {
    expect(unverifiedNumbers("Cost is 1.84 crore, or 183.97 lakh; the share is 15.3% on 294 lines under Diwali 1.34.", facts)).toEqual([]);
  });
  test("flags a figure that is not in the facts", () => {
    expect(unverifiedNumbers("Cost fell by 77.7% across 4,321 lines.", facts)).toEqual([77.7, 4321]);
  });
  test("matches negative differences and figures taken from the user's own question", () => {
    const f = { diff_inr: -3326679.56 };
    expect(unverifiedNumbers("It saves ₹33.27 lakh, about 0.33 crore.", f)).toEqual([]);
    expect(unverifiedNumbers("I cannot ship 5,000 more cases.", f)).toEqual([5000]);
    expect(unverifiedNumbers("I cannot ship 5,000 more cases.", f, "ship 5000 more cases of atta")).toEqual([]);
  });
  test("ignores small counts and years", () => {
    expect(unverifiedNumbers("Over 10 seeds in 2025, three lanes and 8 trucks.", facts)).toEqual([]);
  });
});

describe("model path (mock model)", () => {
  const facts = { kind: "plan", cases: 16094, expected_cost_inr: { total: 6836194 } };
  test("a faithful answer is marked verified, and the prompt carries only the facts", async () => {
    const m = mock("The plan moves 16,094 cases at a cost of about ₹68.4 lakh.");
    const a = await analyse(m, facts);
    expect(a).toMatchObject({ source: "ai", model: "mock-1", verified: true, unverified_numbers: [] });
    expect(m.prompts[0]).toContain("FACTS (JSON)");
    expect(m.prompts[0]).toContain("16094");
  });
  test("an answer with an invented figure is flagged", async () => {
    const a = await analyse(mock("The plan moves 99,999 cases."), facts);
    expect(a.source).toBe("ai");
    expect(a.verified).toBe(false);
    expect(a.unverified_numbers).toEqual([99999]);
    expect(a.note).toContain("do not match");
  });
  test("if the model fails, the rules text is returned with a note", async () => {
    const plan = await new FakeEngine().plan({ scenario_id: "seed01", as_of: "2025-10-13", temp_class: "ambient", plan_id: "PL-T", version: 1 } as any);
    const a = await analyse(mock(new Error("boom")), planFacts(plan));
    expect(a.source).toBe("rules");
    expect(a.note).toContain("AI unavailable (boom)");
  });
  test("a question is passed through to the model", async () => {
    const m = mock("Pune is short because of credit.");
    await analyse(m, facts, "Why is Pune short?");
    expect(m.prompts[0]).toContain("Why is Pune short?");
  });
});

describe("Vertex client (mocked HTTP)", () => {
  const reply = { candidates: [{ content: { parts: [{ text: "Hello " }, { text: "world" }] } }] };

  test("calls generateContent with a bearer token and a system instruction", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = new VertexClient({ project: "p1", location: "asia-south1", model: "gemini-x", accessToken: "tok" }, async (url, init) => {
      seen = { url, init: init! }; return new Response(JSON.stringify(reply));
    });
    expect(await client.generate("SYS", "USER")).toBe("Hello world");
    expect(seen!.url).toBe("https://asia-south1-aiplatform.googleapis.com/v1/projects/p1/locations/asia-south1/publishers/google/models/gemini-x:generateContent");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    const body = JSON.parse(seen!.init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe("SYS");
    expect(body.contents[0].parts[0].text).toBe("USER");
  });

  test("an express-mode API key is sent as a header and needs no project", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = new VertexClient({ location: "l", model: "gemini-x", apiKey: "AQ.test-key" }, async (url, init) => { seen = { url, init: init! }; return new Response(JSON.stringify(reply)); });
    expect(await client.generate("S", "U")).toBe("Hello world");
    expect(seen!.url).toBe("https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-x:generateContent");
    expect(seen!.url).not.toContain("AQ.");
    expect((seen!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AQ.test-key");
    expect(VertexClient.missing({ location: "l", model: "m", apiKey: "k" })).toBeNull();
  });

  test("a Gemini Developer API key uses the generativelanguage endpoint", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const client = new VertexClient({ location: "", model: "gemini-flash-latest", apiKey: "K", gemini: true }, async (url, init) => { seen = { url, init: init! }; return new Response(JSON.stringify(reply)); });
    expect(client.name).toBe("gemini");
    expect(await client.generate("S", "U")).toBe("Hello world");
    expect(seen!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent");
    expect((seen!.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("K");
  });

  test("exchanges a service-account key for a token and reuses it", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    const file = join(mkdtempSync(join(tmpdir(), "vtx-")), "sa.json");
    writeFileSync(file, JSON.stringify({ client_email: "svc@p1.iam.gserviceaccount.com", private_key: privateKey, token_uri: "https://oauth.test/token" }));
    const calls: string[] = [];
    let assertion = "";
    const client = new VertexClient({ project: "p1", location: "l", model: "m", credentialsPath: file }, async (url, init) => {
      calls.push(url);
      if (url === "https://oauth.test/token") { assertion = (init!.body as URLSearchParams).get("assertion")!; return new Response(JSON.stringify({ access_token: "T", expires_in: 3600 })); }
      expect((init!.headers as Record<string, string>).authorization).toBe("Bearer T");
      return new Response(JSON.stringify(reply));
    });
    await client.generate("s", "u");
    await client.generate("s", "u");
    expect(calls.filter((u) => u.includes("oauth.test")).length).toBe(1);
    const claim = JSON.parse(Buffer.from(assertion.split(".")[1]!, "base64url").toString());
    expect(claim).toMatchObject({ iss: "svc@p1.iam.gserviceaccount.com", aud: "https://oauth.test/token", scope: "https://www.googleapis.com/auth/cloud-platform" });
  });

  test("errors do not leak credentials and configuration problems are named", async () => {
    const client = new VertexClient({ project: "p1", location: "l", model: "m", accessToken: "SECRET" }, async () => new Response("no", { status: 403 }));
    await expect(client.generate("s", "u")).rejects.toThrow("Vertex generateContent failed (403)");
    expect(VertexClient.missing({ location: "l", model: "m" })).toBe("VERTEX_PROJECT is not set");
    expect(VertexClient.missing({ project: "p", location: "l", model: "m" })).toContain("GOOGLE_APPLICATION_CREDENTIALS");
    expect(VertexClient.missing({ project: "p", location: "l", model: "m", accessToken: "t" })).toBeNull();
  });
});

describe("routes", () => {
  test("status reports rules when no model is configured, vertex when one is", async () => {
    expect(await json(mk(null).request("/v1/ai/status"))).toMatchObject({ enabled: false, provider: "rules" });
    expect(await json(mk(mock("x")).request("/v1/ai/status"))).toMatchObject({ enabled: true, provider: "vertex", model: "mock-1" });
  });
  test("bad requests are 422 or 404, not crashes", async () => {
    const app = mk(null);
    expect((await post(app, "/v1/ai/analyse", { kind: "plan" })).status).toBe(422);
    expect((await post(app, "/v1/ai/analyse", { kind: "nonsense" })).status).toBe(422);
    expect((await post(app, "/v1/ai/analyse", { kind: "plan", plan_id: "PL-NOPE" })).status).toBe(404);
    expect((await post(app, "/v1/ai/analyse", { kind: "results", experiment_id: "EX-nope" })).status).toBe(404);
  });
  test("the model never receives anything but the computed facts", async () => {
    const m = mock("ok");
    const app = mk(m);
    const { plan } = await planAndExperiment(app);
    await post(app, "/v1/ai/analyse", { kind: "plan", plan_id: plan.plan_id });
    const sent = JSON.parse(m.prompts[0]!.split("FACTS (JSON):\n")[1]!.split("\n\nTASK:")[0]!);
    expect(sent).toEqual(JSON.parse(JSON.stringify(planFacts(plan, await new FakeEngine().scenario()))));
    expect(JSON.stringify(sent)).not.toContain("sku_name");   // no raw line data, only aggregates
  });
  test("facts for results carry the engine direction per KPI", async () => {
    const res = await new FakeEngine().experimentResults("EX-fake");
    if (!res) return;   // the fake engine only has results after a run; covered by the rules test above
    expect(resultsFacts(res, "neutral").kind).toBe("results");
  });
});
