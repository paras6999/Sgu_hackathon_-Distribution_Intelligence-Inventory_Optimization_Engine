import type { TrajectorySeries } from "@dia/types";
import { linearScale, niceTicks, polylinePoints } from "@/lib/chart";
import { formatDate, formatNumber } from "@/lib/format";
import { POLICY_COLOUR, POLICY_NAME, type MainPolicy } from "@/lib/names";

const WIDTH = 720;
const HEIGHT = 260;
const PAD = { left: 56, right: 16, top: 12, bottom: 44 };

/** Plain name for a policy id from the trajectory. Unknown ids are shown as they are. */
export function policyLabel(policy: string): string {
  return policy in POLICY_NAME ? POLICY_NAME[policy as MainPolicy] : policy;
}

function policyColour(policy: string): string {
  return policy in POLICY_COLOUR ? POLICY_COLOUR[policy as MainPolicy] : "var(--muted)";
}

/** Closing stock in cases by day, one line per policy. */
export function TrajectoryChart({ series }: { series: TrajectorySeries[] }) {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return <p className="empty">No daily record for this selection.</p>;

  const times = all.map((p) => Date.parse(p.date));
  const x = linearScale(Math.min(...times), Math.max(...times), PAD.left, WIDTH - PAD.right);
  const maxCases = Math.max(...all.map((p) => p.closing_cases));
  const ticks = niceTicks(0, maxCases, 5);
  const yTop = ticks.length > 0 ? ticks[ticks.length - 1] : maxCases;
  const y = linearScale(0, yTop, HEIGHT - PAD.bottom, PAD.top);

  const dates = Array.from(new Set(all.map((p) => p.date))).sort();
  const marks = dates.length > 1 ? [dates[0], dates[Math.floor(dates.length / 2)], dates[dates.length - 1]] : dates;
  const baseline = HEIGHT - PAD.bottom;

  return (
    <>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Stock left by day for each policy">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(t)} y2={y(t)} style={{ stroke: "var(--line-soft)" }} />
              <text x={PAD.left - 6} y={y(t)} textAnchor="end" dominantBaseline="middle">
                {formatNumber(t)}
              </text>
            </g>
          ))}
          <line x1={PAD.left} x2={WIDTH - PAD.right} y1={baseline} y2={baseline} style={{ stroke: "var(--line)" }} />
          <text x={PAD.left} y={PAD.top - 2}>
            Cases in stock
          </text>
          {marks.map((d, i) => (
            <text
              key={d}
              x={x(Date.parse(d))}
              y={baseline + 16}
              textAnchor={i === 0 ? "start" : i === marks.length - 1 ? "end" : "middle"}
            >
              {formatDate(d)}
            </text>
          ))}
          <text x={(PAD.left + WIDTH - PAD.right) / 2} y={HEIGHT - 4} textAnchor="middle">
            Date
          </text>
          {series.map((s) => (
            <polyline
              key={s.policy}
              points={polylinePoints(s.points.map((p) => ({ x: x(Date.parse(p.date)), y: y(p.closing_cases) })))}
              fill="none"
              strokeWidth={2}
              style={{ stroke: policyColour(s.policy) }}
            />
          ))}
          {series.map((s) =>
            s.points.map((p) => (
              <circle
                key={`${s.policy}-${p.date}`}
                cx={x(Date.parse(p.date))}
                cy={y(p.closing_cases)}
                r={2.5}
                style={{ fill: policyColour(s.policy) }}
              >
                <title>
                  {`${policyLabel(s.policy)}, ${formatDate(p.date)}: ${formatNumber(Math.round(p.closing_cases))} cases left`}
                </title>
              </circle>
            )),
          )}
        </svg>
      </div>
      <div className="legend">
        {series.map((s) => (
          <span key={s.policy} className="legend-item">
            <span className="legend-swatch" style={{ background: policyColour(s.policy) }} />
            {policyLabel(s.policy)}
          </span>
        ))}
      </div>
      <p className="caption">Stock left at the end of each day. Only the first two seeds keep daily records.</p>
    </>
  );
}
