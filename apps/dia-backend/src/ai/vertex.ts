/**
 * Minimal Vertex AI (Gemini) client. No SDK: a service-account JWT is exchanged for an access token, then
 * `generateContent` is called. Credentials come only from the environment and are never logged.
 *   VERTEX_PROJECT, VERTEX_LOCATION (default asia-south1), VERTEX_MODEL,
 *   GOOGLE_APPLICATION_CREDENTIALS (service-account JSON path) or VERTEX_ACCESS_TOKEN (e.g. from `gcloud auth print-access-token`).
 */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

export interface LlmClient {
  readonly name: string;
  readonly model: string;
  generate(system: string, user: string): Promise<string>;
}

export interface VertexConfig {
  project?: string;
  location: string;
  model: string;
  credentialsPath?: string;
  accessToken?: string;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

export class VertexClient implements LlmClient {
  readonly name = "vertex";
  private token?: { value: string; expires: number };

  constructor(private readonly cfg: VertexConfig, private readonly fetchImpl: Fetch = fetch) {}

  get model() { return this.cfg.model; }

  /** Why the client cannot run, or null when it is fully configured. */
  static missing(cfg: VertexConfig): string | null {
    if (!cfg.project) return "VERTEX_PROJECT is not set";
    if (!cfg.accessToken && !cfg.credentialsPath) return "set GOOGLE_APPLICATION_CREDENTIALS or VERTEX_ACCESS_TOKEN";
    return null;
  }

  private async accessToken(): Promise<string> {
    if (this.cfg.accessToken) return this.cfg.accessToken;
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const sa = JSON.parse(readFileSync(this.cfg.credentialsPath!, "utf-8")) as { client_email: string; private_key: string; token_uri?: string };
    const uri = sa.token_uri ?? "https://oauth2.googleapis.com/token";
    const iat = Math.floor(Date.now() / 1000);
    const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: uri, iat, exp: iat + 3600 }));
    const sig = b64url(createSign("RSA-SHA256").update(`${head}.${claim}`).sign(sa.private_key));
    const r = await this.fetchImpl(uri, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${head}.${claim}.${sig}` }),
    });
    if (!r.ok) throw new Error(`Vertex token request failed (${r.status})`);
    const j = (await r.json()) as { access_token: string; expires_in: number };
    this.token = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 };
    return j.access_token;
  }

  async generate(system: string, user: string): Promise<string> {
    const { project, location, model } = this.cfg;
    const url = `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
    const r = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await this.accessToken()}` },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
      }),
    });
    if (!r.ok) throw new Error(`Vertex generateContent failed (${r.status})`);
    const j = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("").trim();
    if (!text) throw new Error("Vertex returned no text");
    return text;
  }
}
