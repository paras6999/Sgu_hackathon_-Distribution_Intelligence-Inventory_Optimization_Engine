"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { OrdersView, Plan } from "@dia/types";
import { ApiError, createPlan, describeError, getOrders, getPlan, getScenarios } from "@/lib/api";
import { AS_OF, PLAN_STORAGE_KEY } from "@/lib/config";

const UPDATED_NOTE_MS = 3200;

type OrdersResult = { view: OrdersView | null; error: string | null };

async function loadOrders(planId: string): Promise<OrdersResult> {
  try {
    return { view: await getOrders(planId), error: null };
  } catch (err) {
    const missing = err instanceof ApiError && err.status === 404;
    return { view: null, error: missing ? "Orders are not available yet." : describeError(err) };
  }
}

async function createNewPlan(): Promise<string> {
  const [scenarioId] = await getScenarios();
  if (!scenarioId) throw new Error("The backend has no scenarios to plan from.");
  const plan = await createPlan({
    scenario_id: scenarioId,
    as_of: AS_OF,
    temp_class: "ambient",
    weights: { pi_mult: 1, omega_mult: 1, carbon_inr_per_kg: 0 },
    locks: [],
  });
  return plan.plan_id;
}

/**
 * Loads the plan the page works on. The plan id is kept in localStorage; a new plan is
 * created only when no id is stored (or the stored plan no longer exists).
 */
export function usePlan() {
  const [planId, setPlanId] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [orders, setOrders] = useState<OrdersView | null>(null);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [justUpdated, setJustUpdated] = useState(false);
  const booted = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async (id: string) => {
    const [nextPlan, nextOrders] = await Promise.all([getPlan(id), loadOrders(id)]);
    localStorage.setItem(PLAN_STORAGE_KEY, id);
    setPlanId(id);
    setPlan(nextPlan);
    setOrders(nextOrders.view);
    setOrdersError(nextOrders.error);
    setError(null);
  }, []);

  const markUpdated = useCallback(() => {
    setJustUpdated(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setJustUpdated(false), UPDATED_NOTE_MS);
  }, []);

  useEffect(() => {
    // Guard against the second mount that React runs in development (Strict Mode).
    if (booted.current) return;
    booted.current = true;
    const boot = async () => {
      try {
        const stored = localStorage.getItem(PLAN_STORAGE_KEY);
        if (stored) {
          try {
            await load(stored);
            return;
          } catch (err) {
            if (!(err instanceof ApiError && err.status === 404)) throw err;
          }
        }
        await load(await createNewPlan());
      } catch (err) {
        setError(describeError(err));
      } finally {
        setLoading(false);
      }
    };
    void boot();
  }, [load]);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  /** Reloads the current plan and orders after the assistant changed something. */
  const refresh = useCallback(async () => {
    if (!planId) return;
    try {
      await load(planId);
      markUpdated();
    } catch (err) {
      setError(describeError(err));
    }
  }, [planId, load, markUpdated]);

  /** Switches to another plan id returned by the assistant, then loads it. */
  const switchPlan = useCallback(
    async (id: string) => {
      try {
        await load(id);
        markUpdated();
      } catch (err) {
        setError(describeError(err));
      }
    },
    [load, markUpdated],
  );

  return {
    planId,
    plan,
    orders,
    ordersError,
    error,
    loading,
    justUpdated,
    refresh,
    switchPlan,
  };
}
