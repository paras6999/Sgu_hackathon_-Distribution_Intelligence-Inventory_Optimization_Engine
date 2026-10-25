import type { KpiSummary, OpeningState, PolicyName } from "@dia/types";
import { POLICY_NAME } from "@/lib/names";
import {
  bestPolicyValue,
  changeTone,
  findKpi,
  formatKpi,
  formatKpiChange,
  formatRelative,
  KPI_ORDER,
  kpiLabel,
  metaOf,
  targetFor,
  type KpiFormat,
  type Target,
} from "@/lib/results";
import styles from "./Results.module.css";

type Entry = {
  kpi: string;
  engine: KpiSummary;
  best: number | null;
  target: Target | null;
  met: boolean | null;
};

/** One policy's mean with its 90% half-width under it. */
function policyCell(rows: KpiSummary[], kpi: string, policy: PolicyName, fmt: KpiFormat) {
  const row = findKpi(rows, kpi, policy);
  if (!row) return "–";
  return (
    <>
      {formatKpi(row.mean, fmt)}
      <span className={styles.cellSub}>± {formatKpi(Math.abs(row.ci_high - row.mean), fmt)}</span>
    </>
  );
}

/** Measure by policy, the engine's gap to the better policy, the target, and whether it is met. */
export function Scorecard({ rows, state }: { rows: KpiSummary[]; state: OpeningState }) {
  const entries: Entry[] = KPI_ORDER.flatMap((kpi) => {
    const engine = findKpi(rows, kpi, "engine");
    if (!engine) return [];
    const best = bestPolicyValue(engine);
    const target = targetFor(kpi, state);
    const met = target && best !== null ? target.met(engine, best) : null;
    return [{ kpi, engine, best, target, met }];
  });
  const judged = entries.filter((entry) => entry.met !== null);
  const metCount = judged.filter((entry) => entry.met).length;

  return (
    <div>
      <p className={styles.targetLine}>
        <b>
          {metCount} of {judged.length} targets met.
        </b>{" "}
        Targets that are not met are shown as measured.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Measure</th>
              <th className="num">{POLICY_NAME.baseline_a}</th>
              <th className="num">{POLICY_NAME.baseline_b}</th>
              <th className="num">{POLICY_NAME.engine}</th>
              <th>Engine against better policy</th>
              <th>Target</th>
              <th>Met</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(({ kpi, engine, best, target, met }) => {
              const meta = metaOf(kpi);
              const delta = engine.delta_vs_best_baseline ?? null;
              const tone = changeTone(kpi, delta);
              const relative = meta.fmt === "pct" || delta === null || best === null ? "" : formatRelative(delta, best);
              const lo = engine.delta_ci_low;
              const hi = engine.delta_ci_high;
              return (
                <tr key={kpi}>
                  <td>{kpiLabel(kpi)}</td>
                  <td className="num">{policyCell(rows, kpi, "baseline_a", meta.fmt)}</td>
                  <td className="num">{policyCell(rows, kpi, "baseline_b", meta.fmt)}</td>
                  <td className="num">
                    <b>{policyCell(rows, kpi, "engine", meta.fmt)}</b>
                  </td>
                  <td>
                    {delta === null ? (
                      "–"
                    ) : (
                      <>
                        <span className={tone === "good" ? "delta-up" : tone === "bad" ? "delta-down" : "delta-0"}>
                          {formatKpiChange(delta, meta.fmt)}
                          {relative && ` (${relative})`}
                        </span>
                        {lo != null && hi != null && (
                          <span className={styles.cellSub}>
                            90% range {formatKpiChange(Math.min(lo, hi), meta.fmt)} to{" "}
                            {formatKpiChange(Math.max(lo, hi), meta.fmt)}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className="muted">{target?.text ?? "–"}</td>
                  <td>
                    {met === null ? (
                      "–"
                    ) : met ? (
                      <span className="status tone-ok">Met</span>
                    ) : (
                      <span className="status tone-bad">Not met</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
