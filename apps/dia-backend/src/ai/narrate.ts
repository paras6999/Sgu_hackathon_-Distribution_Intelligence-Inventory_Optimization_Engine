/**
 * Optional AI narration layer (owner: M1, holds the Vertex AI credentials). PRD FR-25, P2.
 *
 * Rules (docs/Rules.md): AI only explains; quantities come only from the optimiser. Off unless
 * AI_ENABLED=true. Credentials come from the environment (VERTEX_PROJECT, VERTEX_LOCATION,
 * application-default credentials) and are never committed. With AI off, a fixed template answers,
 * so the demo works offline.
 */
import type { Plan } from "@dia/types";
import { env } from "../env";

export async function narratePlan(plan: Plan): Promise<string> {
  if (!env.aiEnabled) {
    const cases = plan.lines.reduce((s, l) => s + l.cases, 0);
    const codes = new Set(plan.lines.flatMap((l) => (l.reasons ?? []).map((r) => r.code)));
    return `Plan ${plan.plan_id} v${plan.version}: ${plan.lines.length} lines, ${cases} cases. Main reasons: ${[...codes].join(", ") || "none"}.`;
  }
  throw new Error("Vertex AI narration not implemented yet (M1)");
}
