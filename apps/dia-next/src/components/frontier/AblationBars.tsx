import type { AblationRow } from "@dia/types";
import { linearScale } from "@/lib/chart";
import { formatRupees } from "@/lib/format";
import { POLICY_LABEL } from "@/lib/names";
import { formatPoints } from "@/lib/results";
import styles from "./Frontier.module.css";

/** Cost change with each part switched off, against the full engine. A bar to the right means the part saves money. */
export function AblationBars({ rows }: { rows: AblationRow[] }) {
  const reach = Math.max(
    1,
    ...rows.flatMap((r) => [Math.abs(r.ci_low), Math.abs(r.ci_high), Math.abs(r.delta_cost_to_serve_inr)]),
  );
  const x = linearScale(-reach, reach, 0, 100);

  return (
    <div className={styles.bars}>
      {rows.map((r) => {
        const low = Math.min(r.ci_low, r.ci_high);
        const high = Math.max(r.ci_low, r.ci_high);
        const saves = r.delta_cost_to_serve_inr >= 0;
        const colour = saves ? "var(--ok)" : "var(--warn)";
        const label = POLICY_LABEL[r.variant];
        return (
          <div key={r.variant} className={styles.barRow}>
            <span>{label}</span>
            <svg viewBox="0 0 100 20" preserveAspectRatio="none" className={styles.barSvg} role="img" aria-label={label}>
              <title>{`${label}: cost change ${formatRupees(r.delta_cost_to_serve_inr, true)}`}</title>
              <line x1={x(0)} x2={x(0)} y1={0} y2={20} className={styles.zero} vectorEffect="non-scaling-stroke" />
              <rect
                x={Math.min(x(0), x(r.delta_cost_to_serve_inr))}
                y={5}
                width={Math.abs(x(r.delta_cost_to_serve_inr) - x(0))}
                height={10}
                style={{ fill: colour }}
              />
              <line
                x1={x(low)}
                x2={x(high)}
                y1={10}
                y2={10}
                className={styles.whisker}
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <b className={styles.barValue} style={{ color: colour }}>
              {formatRupees(r.delta_cost_to_serve_inr, true)}
            </b>
          </div>
        );
      })}
    </div>
  );
}

/** The same numbers as the bars, with the 90% range and the other two changes. */
export function AblationTable({ rows }: { rows: AblationRow[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Switched off</th>
            <th className="num">Cost change</th>
            <th className="num">Demand met change</th>
            <th className="num">Wasted stock change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const low = Math.min(r.ci_low, r.ci_high);
            const high = Math.max(r.ci_low, r.ci_high);
            return (
              <tr key={r.variant}>
                <td>{POLICY_LABEL[r.variant]}</td>
                <td className="num">
                  {formatRupees(r.delta_cost_to_serve_inr, true)}
                  <span className={styles.cellSub}>
                    90% range {formatRupees(low, true)} to {formatRupees(high, true)}
                  </span>
                </td>
                <td className="num">{formatPoints(r.delta_fill_rate_pp)}</td>
                <td className="num">{formatRupees(r.delta_wastage_inr, true)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
