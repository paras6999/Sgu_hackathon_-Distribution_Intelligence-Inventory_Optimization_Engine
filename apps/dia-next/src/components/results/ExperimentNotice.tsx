import type { ExperimentState } from "@/hooks/useExperiment";

/** Shows the progress of a running evaluation, or the error that stopped it. Nothing when the run is done. */
export function ExperimentNotice({ ex }: { ex: ExperimentState }) {
  if (ex.error) {
    return (
      <p className="notice error" role="alert">
        {ex.error}
      </p>
    );
  }
  const status = ex.info?.status;
  if (status === "queued" || status === "running") {
    return (
      <p className="notice" role="status">
        Experiment {ex.id} is running, {Math.round(ex.info?.progress_pct ?? 0)}% done. This page refreshes itself.
      </p>
    );
  }
  return null;
}
