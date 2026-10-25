"use client";

import { useState } from "react";
import type { TempClass } from "@dia/types";
import { useApp } from "@/context/AppContext";
import { createPlan, describeError, getScenarios } from "@/lib/api";
import { AS_OF } from "@/lib/config";
import styles from "./PlanGenerator.module.css";

const MIN_AS_OF = "2025-09-29";
const MAX_AS_OF = "2025-12-21";

/** Creates a new plan for a chosen date and temperature class, then shows it on the page. */
export function PlanGenerator() {
  const { plan, switchPlan } = useApp();
  const [asOf, setAsOf] = useState(AS_OF);
  const [temp, setTemp] = useState<TempClass>("ambient");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inRange = asOf >= MIN_AS_OF && asOf <= MAX_AS_OF;

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const scenarioId = plan?.scenario_id ?? (await getScenarios())[0];
      if (!scenarioId) throw new Error("The backend has no scenarios to plan from.");
      const created = await createPlan({
        scenario_id: scenarioId,
        as_of: asOf,
        temp_class: temp,
        weights: { pi_mult: 1, omega_mult: 1, carbon_inr_per_kg: 0 },
        locks: [],
      });
      await switchPlan(created.plan_id);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.bar}>
      <div className={styles.controls}>
        <label className={styles.field}>
          As of
          <input
            type="date"
            value={asOf}
            min={MIN_AS_OF}
            max={MAX_AS_OF}
            disabled={busy}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          Temperature class
          <select value={temp} disabled={busy} onChange={(e) => setTemp(e.target.value as TempClass)}>
            <option value="ambient">Ambient</option>
            <option value="chilled">Chilled</option>
          </select>
        </label>
        <button type="button" className="btn" disabled={busy || !inRange} onClick={() => void generate()}>
          {busy ? "Generating…" : "Generate new plan"}
        </button>
      </div>
      {!inRange && asOf !== "" && (
        <span className={styles.hint}>
          Pick a date from {MIN_AS_OF} to {MAX_AS_OF}.
        </span>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
