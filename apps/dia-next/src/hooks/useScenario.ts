"use client";

import { useEffect, useState } from "react";
import type { Scenario } from "@dia/types";
import { describeError, getScenario, getScenarios } from "@/lib/api";

export type ScenarioState = {
  scenarioId: string | null;
  scenario: Scenario | null;
  error: string | null;
  loading: boolean;
};

/** Loads the first scenario the backend lists, with its nodes, products and lanes. */
export function useScenario(): ScenarioState {
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [id] = await getScenarios();
        if (!id) throw new Error("The backend has no scenarios.");
        const data = await getScenario(id);
        if (!cancelled) {
          setScenarioId(id);
          setScenario(data);
        }
      } catch (err) {
        if (!cancelled) setError(describeError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { scenarioId, scenario, error, loading };
}
