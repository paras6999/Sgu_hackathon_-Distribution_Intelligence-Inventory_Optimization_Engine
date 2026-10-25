"use client";

import { useCallback, useEffect, useState } from "react";
import type { ExperimentInfo, ExperimentResults } from "@dia/types";
import { ApiError, describeError, getExperiment, getResults, startExperiment } from "@/lib/api";
import { MAIN_EXPERIMENT, POLL_MS, RESULT_EXPERIMENT_ID } from "@/lib/config";

export type ExperimentState = {
  /** Id of the run the page reads, or null until one is known. */
  id: string | null;
  /** Latest status. While the run is queued or running, `progress_pct` gives the percentage done. */
  info: ExperimentInfo | null;
  results: ExperimentResults | null;
  error: string | null;
  /** True until the results or an error are known. */
  loading: boolean;
  reload: () => void;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The stored run, or null when the backend does not know its id (404). */
async function findStored(): Promise<ExperimentInfo | null> {
  try {
    return await getExperiment(RESULT_EXPERIMENT_ID);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Uses the stored run unless it is missing or failed. Only then starts a new run. */
async function resolveRun(): Promise<ExperimentInfo> {
  const stored = await findStored();
  if (stored && stored.status !== "failed") return stored;
  const accepted = await startExperiment(MAIN_EXPERIMENT);
  return getExperiment(accepted.experiment_id);
}

/** Loads the evaluation run behind the results, frontier and stock pages, polling while it runs. */
export function useExperiment(): ExperimentState {
  const [tick, setTick] = useState(0);
  const [id, setId] = useState<string | null>(null);
  const [info, setInfo] = useState<ExperimentInfo | null>(null);
  const [results, setResults] = useState<ExperimentResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        let current = await resolveRun();
        if (cancelled) return;
        setId(current.experiment_id);
        setInfo(current);
        while (current.status === "queued" || current.status === "running") {
          await wait(POLL_MS);
          if (cancelled) return;
          current = await getExperiment(current.experiment_id);
          if (cancelled) return;
          setInfo(current);
        }
        if (current.status === "failed") {
          setError(current.error ?? "The evaluation run failed.");
        } else {
          const data = await getResults(current.experiment_id);
          if (!cancelled) setResults(data);
        }
      } catch (err) {
        if (!cancelled) setError(describeError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setResults(null);
    setTick((t) => t + 1);
  }, []);

  return { id, info, results, error, loading, reload };
}
