"use client";

import { useEffect, useState } from "react";
import type { BacktestMetrics, DemandHistory, LearnedEffects } from "@dia/types";
import { describeError, getBacktest, getEffects, getHistory } from "@/lib/api";

/** A finished request: the data, or the error text. */
export type Loaded<T> = { data?: T; error?: string };

/** A history result tagged with the filters it was requested for. */
type KeyedHistory = Loaded<DemandHistory> & { key: string };

/** Identifies one filter selection, so a late response for an old selection is never shown. */
export function historyKey(scenarioId: string, distId: string, skuId: string): string {
  return [scenarioId, distId, skuId].join("|");
}

/**
 * Loads the weekly history for the chosen filters, plus the learned effects and backtest scores once.
 * A result is null while the request for the current filters is still running.
 */
export function useDemandData(scenarioId: string | null, distId: string, skuId: string) {
  const [history, setHistory] = useState<KeyedHistory | null>(null);
  const [effects, setEffects] = useState<Loaded<LearnedEffects> | null>(null);
  const [metrics, setMetrics] = useState<Loaded<BacktestMetrics> | null>(null);

  useEffect(() => {
    if (!scenarioId) return;
    const key = historyKey(scenarioId, distId, skuId);
    let active = true;
    getHistory(scenarioId, distId || undefined, skuId || undefined).then(
      (data) => {
        if (active) setHistory({ key, data });
      },
      (err: unknown) => {
        if (active) setHistory({ key, error: describeError(err) });
      },
    );
    return () => {
      active = false;
    };
  }, [scenarioId, distId, skuId]);

  useEffect(() => {
    if (!scenarioId) return;
    let active = true;
    getEffects(scenarioId).then(
      (data) => {
        if (active) setEffects({ data });
      },
      (err: unknown) => {
        if (active) setEffects({ error: describeError(err) });
      },
    );
    return () => {
      active = false;
    };
  }, [scenarioId]);

  useEffect(() => {
    if (!scenarioId) return;
    let active = true;
    getBacktest(scenarioId).then(
      (data) => {
        if (active) setMetrics({ data });
      },
      (err: unknown) => {
        if (active) setMetrics({ error: describeError(err) });
      },
    );
    return () => {
      active = false;
    };
  }, [scenarioId]);

  const currentKey = historyKey(scenarioId ?? "", distId, skuId);
  return {
    history: history?.key === currentKey ? history : null,
    effects,
    metrics,
  };
}
