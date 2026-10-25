"use client";

import { useEffect, useState } from "react";
import type { Node, OpeningState, Sku, Trajectory, TrajectoryPoint } from "@dia/types";
import type { ExperimentState } from "@/hooks/useExperiment";
import { ApiError, describeError, getTrajectory } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { OPENING_NAME } from "@/lib/names";
import { policyLabel, TrajectoryChart } from "./TrajectoryChart";
import styles from "./StockWatch.module.css";

const OPENINGS: OpeningState[] = ["neutral", "imbalanced"];
const SEEDS = [1, 2];

type Props = {
  experiment: ExperimentState;
  skus: Sku[];
  nodes: Node[];
  skuId: string | null;
  distId: string | null;
  opening: OpeningState;
  seed: number;
  onSku: (skuId: string) => void;
  onDist: (distId: string) => void;
  onOpening: (opening: OpeningState) => void;
  onSeed: (seed: number) => void;
};

type Loaded = { key: string; data?: Trajectory; error?: string };

function totals(points: TrajectoryPoint[]) {
  return points.reduce(
    (sum, p) => ({
      sold: sum.sold + p.sales_cases,
      missed: sum.missed + p.lost_cases,
      expired: sum.expired + p.expired_cases,
    }),
    { sold: 0, missed: 0, expired: 0 },
  );
}

/** Stock over the 12 weeks for one product at one place, from the stored evaluation run. */
export function TrajectoryBox({
  experiment,
  skus,
  nodes,
  skuId,
  distId,
  opening,
  seed,
  onSku,
  onDist,
  onOpening,
  onSeed,
}: Props) {
  // Daily records come from the evaluation run, so wait until that run is done.
  const runId = experiment.results ? experiment.id : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!runId || !skuId || !distId) return;
    let active = true;
    const key = [runId, skuId, distId, opening, seed].join("|");
    getTrajectory(runId, { sku_id: skuId, dist_id: distId, opening_state: opening, seed }).then(
      (data) => {
        if (active) setLoaded({ key, data });
      },
      (err: unknown) => {
        if (!active) return;
        const missing = err instanceof ApiError && err.status === 404;
        setLoaded({ key, error: missing ? "No daily record for this selection." : describeError(err) });
      },
    );
    return () => {
      active = false;
    };
  }, [runId, skuId, distId, opening, seed]);

  const key = runId && skuId && distId ? [runId, skuId, distId, opening, seed].join("|") : null;
  const current = key !== null && loaded?.key === key ? loaded : null;
  const running = experiment.info?.status === "queued" || experiment.info?.status === "running";

  let status: { kind: "error" | "info" | "empty"; text: string } | null = null;
  if (experiment.error) {
    status = { kind: "error", text: experiment.error };
  } else if (!experiment.results) {
    status = running
      ? { kind: "info", text: `Running, ${Math.round(experiment.info?.progress_pct ?? 0)}% done. This box refreshes itself.` }
      : { kind: "empty", text: "Loading the evaluation run…" };
  } else if (!skuId || !distId) {
    status = { kind: "empty", text: "Pick a product and a place." };
  } else if (current?.error) {
    status = { kind: "error", text: current.error };
  } else if (!current) {
    status = { kind: "empty", text: "Loading stock over time…" };
  }

  return (
    <div className="box">
      <h2>Stock over the 12 weeks</h2>
      <div className={styles.controls}>
        <label className={styles.field}>
          Product
          <select value={skuId ?? ""} onChange={(e) => onSku(e.target.value)} disabled={skus.length === 0}>
            {skus.map((s) => (
              <option key={s.sku_id} value={s.sku_id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Place
          <select value={distId ?? ""} onChange={(e) => onDist(e.target.value)} disabled={nodes.length === 0}>
            {nodes.map((n) => (
              <option key={n.node_id} value={n.node_id}>
                {n.city} ({n.type === "depot" ? "depot" : "distributor"})
              </option>
            ))}
          </select>
        </label>
        <div className="seg" role="group" aria-label="Opening stock">
          {OPENINGS.map((o) => (
            <button
              key={o}
              type="button"
              className={`seg-btn${opening === o ? " on" : ""}`}
              aria-pressed={opening === o}
              onClick={() => onOpening(o)}
            >
              {OPENING_NAME[o]}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Run">
          {SEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={`seg-btn${seed === s ? " on" : ""}`}
              aria-pressed={seed === s}
              onClick={() => onSeed(s)}
            >
              Seed {s}
            </button>
          ))}
        </div>
      </div>

      {status && (
        <p className={status.kind === "error" ? "notice error" : status.kind === "info" ? "notice" : "empty"} role={status.kind === "error" ? "alert" : undefined}>
          {status.text}
        </p>
      )}

      {current?.data && (
        <>
          <TrajectoryChart series={current.data.series} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Policy</th>
                  <th className="num">Total sold (cases)</th>
                  <th className="num">Total missed (cases)</th>
                  <th className="num">Total expired (cases)</th>
                </tr>
              </thead>
              <tbody>
                {current.data.series.map((s) => {
                  const t = totals(s.points);
                  return (
                    <tr key={s.policy}>
                      <td>{policyLabel(s.policy)}</td>
                      <td className="num">{formatNumber(Math.round(t.sold))}</td>
                      <td className="num">{formatNumber(Math.round(t.missed))}</td>
                      <td className="num">{formatNumber(Math.round(t.expired))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
