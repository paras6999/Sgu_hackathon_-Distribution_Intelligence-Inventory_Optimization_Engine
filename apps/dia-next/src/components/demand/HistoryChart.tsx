import type { CSSProperties } from "react";
import type { DemandHistory } from "@dia/types";
import { linearScale, niceTicks, polylinePoints } from "@/lib/chart";
import { formatDate, formatNumber } from "@/lib/format";
import { SEASON_MONTHS } from "@/lib/names";

const W = 960;
const H = 340;
const L = 64;
const R = 16;
const T = 34;
const B = 40;

const GRID: CSSProperties = { stroke: "var(--line-soft)" };
const AXIS: CSSProperties = { stroke: "var(--control-line)" };
const ACTUAL: CSSProperties = { stroke: "var(--text)" };
const ACTUAL_DOT: CSSProperties = { fill: "var(--text)" };
const FORECAST: CSSProperties = { stroke: "var(--brand)" };
const FORECAST_DOT: CSSProperties = { fill: "var(--brand)" };
const RANGE: CSSProperties = { fill: "var(--brand)", opacity: 0.16 };
const FESTIVAL: CSSProperties = { fill: "var(--warn-soft)" };
const FESTIVAL_TEXT: CSSProperties = { fill: "var(--warn)" };

/** Festival names are cut to this many characters on the chart. The full name stays in the tooltip. */
const LABEL_MAX = 14;

function shortName(name: string): string {
  return name.length > LABEL_MAX ? `${name.slice(0, LABEL_MAX - 1)}…` : name;
}

/** Weekly actual cases, the forecast for each week, the 80% range, and festival run-ups. */
export function HistoryChart({ history }: { history: DemandHistory }) {
  const { weekly, backtest } = history;
  const last = Math.max(weekly.length - 1, 1);
  const step = (W - L - R) / last;
  const indexOf = new Map(weekly.map((p, i) => [p.week_start, i]));
  const top = Math.max(1, ...weekly.map((p) => p.actual), ...backtest.map((p) => p.p90));
  const ticks = niceTicks(0, top, 5);
  const yMax = ticks[ticks.length - 1] ?? top;
  const x = linearScale(0, last, L, W - R);
  const y = linearScale(0, yMax, H - B, T);

  const forecast = backtest
    .flatMap((p) => {
      const i = indexOf.get(p.week_start);
      return i === undefined ? [] : [{ i, p }];
    })
    .sort((a, b) => a.i - b.i);
  const testStart = forecast.length > 0 ? forecast[0].i : null;

  const spans = history.festivals.flatMap((f) => {
    const start = weekly.findIndex((p) => p.week_start >= f.start);
    const end = weekly.findLastIndex((p) => p.week_start <= f.end);
    return start >= 0 && end >= start ? [{ name: f.name, start, end }] : [];
  });

  // Festival labels go on the first of three rows where they fit after the label before them. A label with no free row
  // is left off the chart (its band stays, and the name is in the tooltip), so labels never overlap.
  const LABEL_ROWS = 3;
  const CHAR_W = 6.4;
  const rowEnds = Array.from({ length: LABEL_ROWS }, () => -Infinity);
  const byDate = [...spans].sort((a, b) => a.start - b.start);
  const labels = byDate.map((s, k) => {
    const left = x(s.start) - step / 2 + 4;
    const text = shortName(s.name);
    const row = rowEnds.findIndex((end) => left > end + 6);
    if (row === -1) return null;
    rowEnds[row] = left + text.length * CHAR_W;
    return { key: `${s.name}-${s.start}-${k}`, text, name: s.name, x: left, row };
  });

  const months = weekly.flatMap((p, i) => {
    const month = Number(p.week_start.slice(5, 7));
    const before = i > 0 ? Number(weekly[i - 1].week_start.slice(5, 7)) : 0;
    if (month === before || (month - 1) % 3 !== 0) return [];
    return [{ i, label: `${SEASON_MONTHS[month - 1]} ${p.week_start.slice(0, 4)}` }];
  });

  const band =
    history.has_band && forecast.length > 0
      ? polylinePoints([
          ...forecast.map(({ i, p }) => ({ x: x(i), y: y(p.p90) })),
          ...[...forecast].reverse().map(({ i, p }) => ({ x: x(i), y: y(p.p10) })),
        ])
      : null;

  return (
    <>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weekly cases, actual and forecast">
          <text x={0} y={14}>
            Cases per week
          </text>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} style={GRID} />
              <text x={L - 8} y={y(v) + 4} textAnchor="end">
                {formatNumber(v)}
              </text>
            </g>
          ))}
          {spans.map((s) => (
            <rect
              key={`${s.name}-${s.start}`}
              x={x(s.start) - step / 2}
              y={T}
              width={(s.end - s.start + 1) * step}
              height={H - B - T}
              style={FESTIVAL}
            >
              <title>{s.name}</title>
            </rect>
          ))}
          {labels.map((label) =>
            label ? (
              <text key={label.key} x={label.x} y={T + 12 + label.row * 14} style={FESTIVAL_TEXT}>
                <title>{label.name}</title>
                {label.text}
              </text>
            ) : null,
          )}
          {testStart !== null && (
            <g>
              <line
                x1={x(testStart)}
                x2={x(testStart)}
                y1={T}
                y2={H - B}
                style={AXIS}
                strokeDasharray="4 3"
              />
              <text x={x(testStart) + 4} y={H - B - 6}>
                Forecast tested from here
              </text>
            </g>
          )}
          {band && <polygon points={band} stroke="none" style={RANGE} />}
          <polyline
            points={polylinePoints(weekly.map((p, i) => ({ x: x(i), y: y(p.actual) })))}
            fill="none"
            strokeWidth={1.6}
            style={ACTUAL}
          />
          {forecast.length > 0 && (
            <polyline
              points={polylinePoints(forecast.map(({ i, p }) => ({ x: x(i), y: y(p.p50) })))}
              fill="none"
              strokeWidth={2}
              style={FORECAST}
            />
          )}
          {weekly.map((p, i) => (
            <circle key={`a-${p.week_start}`} cx={x(i)} cy={y(p.actual)} r={2.5} style={ACTUAL_DOT}>
              <title>{`Week of ${formatDate(p.week_start)}: ${formatNumber(p.actual)} cases`}</title>
            </circle>
          ))}
          {forecast.map(({ i, p }) => (
            <circle key={`f-${p.week_start}`} cx={x(i)} cy={y(p.p50)} r={2.5} style={FORECAST_DOT}>
              <title>{`Forecast for week of ${formatDate(p.week_start)}: ${formatNumber(p.p50)} cases`}</title>
            </circle>
          ))}
          <line x1={L} x2={W - R} y1={H - B} y2={H - B} style={AXIS} />
          {months.map(({ i, label }) => (
            <text key={i} x={x(i)} y={H - B + 16}>
              {label}
            </text>
          ))}
        </svg>
      </div>
      <div className="legend">
        <span className="legend-item">
          <i className="legend-swatch" style={{ background: "var(--text)" }} />
          Actual cases
        </span>
        <span className="legend-item">
          <i className="legend-swatch" style={{ background: "var(--brand)" }} />
          Forecast, 1 to 4 weeks ahead
        </span>
        {history.has_band && (
          <span className="legend-item">
            <i className="legend-swatch" style={{ background: "var(--brand)", opacity: 0.3 }} />
            80% range
          </span>
        )}
        <span className="legend-item">
          <i
            className="legend-swatch"
            style={{ background: "var(--warn-soft)", boxShadow: "inset 0 0 0 1px var(--warn)" }}
          />
          Festival run-up
        </span>
      </div>
      <p className="caption">
        {history.has_band
          ? "Weekly cases against the forecast made 1 to 4 weeks ahead. Shaded columns mark festival run-ups."
          : "Pick one distributor and one product to see the 80% range."}
      </p>
    </>
  );
}
