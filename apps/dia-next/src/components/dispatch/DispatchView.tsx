"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { DispatchTruck } from "@dia/types";
import { useApp } from "@/context/AppContext";
import { describeError, getDispatch } from "@/lib/api";
import {
  depotName,
  formatDate,
  formatNumber,
  reasonLabel,
  truckClassLabel,
  truckModeLabel,
} from "@/lib/format";
import styles from "./Dispatch.module.css";

/** A dispatch result tagged with the key it was made for, so a stale result is never shown. */
type Loaded = { key: string; trucks?: DispatchTruck[]; error?: string };

/** Shows a depot or distributor id as its city: "W1-Bhiwandi" becomes "Bhiwandi", "D01-Pune" becomes "Pune". */
function placeName(id: string): string {
  const named = depotName(id);
  if (named !== id) return named;
  const dash = id.indexOf("-");
  return dash >= 0 ? id.slice(dash + 1) : id;
}

function clampPct(pct: number): number {
  return Math.min(100, Math.max(0, pct));
}

function Meter({ label, pct }: { label: string; pct: number }) {
  return (
    <div className={styles.meter}>
      <span className="muted">{label}</span>
      <span className="bar" role="img" aria-label={`${label} ${Math.round(pct)} percent`}>
        <i style={{ width: `${clampPct(pct)}%` }} />
      </span>
      <span className={styles.meterValue}>{Math.round(pct)}%</span>
    </div>
  );
}

export function DispatchView() {
  const { planId, plan, loading } = useApp();
  const [depot, setDepot] = useState("");
  const [result, setResult] = useState<Loaded | null>(null);
  const version = plan?.version ?? 0;
  const key = `${planId}|${version}|${depot}`;

  useEffect(() => {
    if (!planId) return;
    let active = true;
    getDispatch(planId, depot).then(
      (data) => {
        if (active) setResult({ key, trucks: data.trucks });
      },
      (err: unknown) => {
        if (active) setResult({ key, error: describeError(err) });
      },
    );
    return () => {
      active = false;
    };
  }, [key, planId, depot]);

  const current = result?.key === key ? result : null;
  const depots = plan ? [...new Set(plan.trucks.map((t) => t.from_id))].sort() : [];
  const csvPath = planId ? `/v1/plans/${encodeURIComponent(planId)}/dispatch.csv` : "";
  const csvUrl = depot ? `${csvPath}?depot=${encodeURIComponent(depot)}` : csvPath;

  let body: ReactNode;
  if (!plan) {
    body = (
      <p className="empty">{loading ? "Loading the plan…" : "Create a plan on Planning first."}</p>
    );
  } else if (current?.error) {
    body = <p className="notice error">{current.error}</p>;
  } else if (!current?.trucks) {
    body = <p className="empty">Loading trucks…</p>;
  } else if (current.trucks.length === 0) {
    body = <p className="empty">No trucks leave this depot in the plan.</p>;
  } else {
    body = (
      <div className={styles.list}>
        {current.trucks.map(({ truck, lines }) => (
          <article key={truck.truck_id} className={styles.truck}>
            <header className={styles.truckHead}>
              <div className={styles.truckTitle}>
                <span className={styles.truckId}>{truck.truck_id}</span>
                <span className="muted">
                  {truckModeLabel(truck.mode)} · {truckClassLabel(truck.truck_class)}
                </span>
              </div>
              <div className={styles.destination}>
                <span className="muted">Destination</span>
                <b>{placeName(truck.to_id)}</b>
              </div>
              <div className={styles.meters}>
                <Meter label="Weight" pct={truck.kg_pct} />
                <Meter label="Volume" pct={truck.m3_pct} />
              </div>
            </header>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Lot</th>
                    <th>Expiry</th>
                    <th className="num">Cases</th>
                    <th>Why</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.line_id}>
                      <td>{line.sku_name}</td>
                      <td className={styles.mono}>{line.lot_id}</td>
                      <td>{formatDate(line.expiry)}</td>
                      <td className="num">{formatNumber(line.cases)}</td>
                      <td>{line.reasons?.[0] ? reasonLabel(line.reasons[0].code) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <section className="record" data-page="dispatch" data-ready={current?.trucks ? "true" : "false"}>
      <div className="record-head">
        <div>
          <div className="kind">Planning cycle</div>
          <h1>
            Dispatch
            {plan && <span className="pill">Version {plan.version}</span>}
          </h1>
        </div>
        <span className="spacer" />
        {plan && (
          <>
            <label className={styles.field}>
              Depot
              <select value={depot} onChange={(e) => setDepot(e.target.value)}>
                <option value="">All depots</option>
                {depots.map((id) => (
                  <option key={id} value={id}>
                    {placeName(id)}
                  </option>
                ))}
              </select>
            </label>
            <a className={`btn ${styles.csv}`} href={csvUrl}>
              Download CSV
            </a>
          </>
        )}
      </div>
      <p className={styles.sub}>
        What each depot loads, truck by truck. Lines are in pick order, soonest expiry first, so the
        oldest stock goes out first.
      </p>
      {body}
    </section>
  );
}
