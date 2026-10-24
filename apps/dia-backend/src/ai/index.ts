/** Chooses the analysis path from the environment (AI_ENABLED, VERTEX_*). Off by default; the rules path always works. */
import { env } from "../env";
import { VertexClient, type LlmClient } from "./vertex";

export interface AiStatus {
  enabled: boolean;
  provider: "vertex" | "gemini" | "rules";
  model: string | null;
  reason: string | null;
}

export function llmFromEnv(): { llm: LlmClient | null; status: AiStatus } {
  if (!env.aiEnabled) return { llm: null, status: { enabled: false, provider: "rules", model: null, reason: "AI_ENABLED is not true" } };
  if (env.geminiApiKey) {
    const g = { location: "", model: env.geminiModel, apiKey: env.geminiApiKey, gemini: true };
    return { llm: new VertexClient(g), status: { enabled: true, provider: "gemini", model: g.model, reason: null } };
  }
  const cfg = {
    project: env.vertexProject, location: env.vertexLocation, model: env.vertexModel,
    credentialsPath: env.googleCredentials, accessToken: env.vertexAccessToken, apiKey: env.vertexApiKey,
  };
  const missing = VertexClient.missing(cfg);
  if (missing) return { llm: null, status: { enabled: false, provider: "rules", model: null, reason: missing } };
  return { llm: new VertexClient(cfg), status: { enabled: true, provider: "vertex", model: cfg.model, reason: null } };
}

export function statusOf(llm: LlmClient | null, fallbackReason: string | null): AiStatus {
  return llm ? { enabled: true, provider: llm.name === "gemini" ? "gemini" : "vertex", model: llm.model, reason: null } : { enabled: false, provider: "rules", model: null, reason: fallbackReason };
}
