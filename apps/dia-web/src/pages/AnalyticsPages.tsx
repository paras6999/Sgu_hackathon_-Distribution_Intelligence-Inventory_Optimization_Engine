/**
 * Analytics pages: placeholders for M3 (backup M2). Each already loads its data, so M3 only builds the
 * visuals described in docs/Design.md. One page per PR; replace the <Placeholder> body, keep the data calls.
 */
import type { Plan } from "@dia/types";
import { useState } from "react";
import { api } from "../api";
import { ErrorText, Placeholder, useLoad } from "../components/ui";

function useExperiment() {
  const [id, setId] = useState<string | null>(null);
  const info = useLoad(() => (id ? api.experiment(id) : Promise.resolve(null)), [id]);
  const results = useLoad(() => (id && info.data?.status === "done" ? api.results(id) : Promise.resolve(null)), [id, info.data?.status]);
  const start = async () => setId((await api.startExperiment()).experiment_id);
  return { id, info, results, start };
}

export function ResultsPage() {
  const ex = useExperiment();
  return (
    <Placeholder owner="M3" title="Results (FR-11)" endpoints={["POST /v1/experiments", "GET /v1/experiments/{id}/results"]}>
      <button className="primary" onClick={ex.start}>Run / load experiment</button>
      <ErrorText error={ex.info.error ?? ex.results.error} />
      {ex.info.data && <p>{ex.info.data.experiment_id}: {ex.info.data.status} ({ex.info.data.progress_pct}%) <button className="secondary" onClick={ex.info.reload}>Refresh</button></p>}
      {ex.results.data && <p>{ex.results.data.kpis.length} KPI rows loaded. Build: KPI cards per policy with mean, 90% CI and delta vs better baseline; opening-state toggle.</p>}
    </Placeholder>
  );
}

export function FrontierPage() {
  return <Placeholder owner="M3" title="Frontier & Ablation (FR-11, FR-12)" endpoints={["GET /v1/experiments/{id}/results → frontier[], ablation[]"]} />;
}

export function MapPage({ plan }: { plan: Plan | null }) {
  return (
    <Placeholder owner="M3" title="Network map (FR-14)" endpoints={["GET /v1/plans/{id}", "GET /v1/scenarios/{id}/snapshot"]}>
      <p>{plan ? `${plan.lines.length} plan lines available for arcs.` : "Generate a plan first."} Build with a free MapLibre basemap (no API key).</p>
    </Placeholder>
  );
}

export function AssumptionsPage() {
  const rows = useLoad(api.assumptions, []);
  return (
    <Placeholder owner="M3" title="Assumptions (FR-15)" endpoints={["GET /v1/assumptions"]}>
      <ErrorText error={rows.error} />
      <p>{rows.data?.length ?? 0} parameters loaded; {rows.data?.filter((r) => r.source).length ?? 0} have a source.</p>
    </Placeholder>
  );
}
