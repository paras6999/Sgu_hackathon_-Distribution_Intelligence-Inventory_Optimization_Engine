import type { CSSProperties } from "react";
import { linearScale, niceTicks, polylinePoints } from "@/lib/chart";
import { SEASON_MONTHS } from "@/lib/names";

const W = 480;
const H = 230;
const L = 52;
const R = 12;
const T = 26;
const B = 30;

const GRID: CSSProperties = { stroke: "var(--line-soft)" };
const LEARNED: CSSProperties = { stroke: "var(--brand)" };
const CONFIGURED: CSSProperties = { stroke: "var(--muted)" };
const LEARNED_DOT: CSSProperties = { fill: "var(--brand)" };

/** Monthly seasonal index for one product group: the learned curve against the configured one. */
export function SeasonChart({ learned, configured }: { learned: number[]; configured: number[] }) {
  const values = [...learned, ...configured];
  if (values.length === 0) return <p className="empty">No seasonal pattern for this group.</p>;

  const ticks = niceTicks(Math.min(...values), Math.max(...values), 4);
  const lo = ticks[0] ?? 0;
  const hi = ticks[ticks.length - 1] ?? 1;
  const x = linearScale(0, SEASON_MONTHS.length - 1, L, W - R);
  const y = linearScale(lo, hi, H - B, T);
  const line = (series: number[]) => polylinePoints(series.map((v, i) => ({ x: x(i), y: y(v) })));

  return (
    <>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly seasonal index, learned and configured">
          <text x={0} y={12}>
            Index, 1.00 is an average month
          </text>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} style={GRID} />
              <text x={L - 6} y={y(v) + 4} textAnchor="end">
                {v.toFixed(2)}
              </text>
            </g>
          ))}
          <polyline points={line(configured)} fill="none" strokeWidth={2} strokeDasharray="4 3" style={CONFIGURED} />
          <polyline points={line(learned)} fill="none" strokeWidth={2.2} style={LEARNED} />
          {learned.map((v, i) => (
            <circle key={SEASON_MONTHS[i]} cx={x(i)} cy={y(v)} r={2.5} style={LEARNED_DOT}>
              <title>{`${SEASON_MONTHS[i]}: learned ${v.toFixed(2)}`}</title>
            </circle>
          ))}
          {SEASON_MONTHS.map((m, i) => (
            <text key={m} x={x(i)} y={H - 8} textAnchor="middle">
              {m}
            </text>
          ))}
        </svg>
      </div>
      <div className="legend">
        <span className="legend-item">
          <i className="legend-swatch" style={{ background: "var(--brand)" }} />
          Learned
        </span>
        <span className="legend-item">
          <i className="legend-swatch" style={{ background: "var(--muted)" }} />
          Configured
        </span>
      </div>
    </>
  );
}
