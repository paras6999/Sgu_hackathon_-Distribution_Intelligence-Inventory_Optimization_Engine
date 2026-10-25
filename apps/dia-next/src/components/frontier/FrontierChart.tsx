import type { FrontierPoint, PolicyName } from "@dia/types";
import { linearScale, niceTicks, polylinePoints } from "@/lib/chart";
import { formatRupees } from "@/lib/format";
import { POLICY_LABEL } from "@/lib/names";
import { isDefaultKnob, KNOB_NAME, knobLabel, policyColour } from "@/lib/results";
import styles from "./Frontier.module.css";

const W = 680;
const H = 360;
const L = 84;
/** Right margin, wide enough that the last cost label (for example ₹5.00 crore) is not cut off. */
const R = 52;
const T = 16;
const B = 56;

/** Approximate size of one label, in SVG units at the chart's 11px font. */
const CHAR_W = 6.4;
const LABEL_UP = 10;
const LABEL_DOWN = 3;

type Anchor = "start" | "end" | "middle";
type Spot = { x: number; y: number; anchor: Anchor };
type Box = { x0: number; x1: number; y0: number; y1: number };

/** Four spots around a point, then two above and below it. Text baseline is at y. */
function candidates(px: number, py: number, width: number): { spot: Spot; box: Box }[] {
  const make = (dx: number, dy: number, anchor: Anchor): { spot: Spot; box: Box } => {
    const x = px + dx;
    const x0 = anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
    const y = py + dy;
    return { spot: { x, y, anchor }, box: { x0, x1: x0 + width, y0: y - LABEL_UP, y1: y + LABEL_DOWN } };
  };
  return [
    make(10, -8, "start"),
    make(10, 16, "start"),
    make(-10, -8, "end"),
    make(-10, 16, "end"),
    make(0, -16, "middle"),
    make(0, 26, "middle"),
  ];
}

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 + 2 && b.x0 < a.x1 + 2 && a.y0 < b.y1 + 2 && b.y0 < a.y1 + 2;
}

/** Chooses a label spot for each point so that labels do not overlap one another. */
function placeLabels(
  items: { key: string; text: string; px: number; py: number; priority: number }[],
): Map<string, Spot> {
  const placed: Box[] = [];
  const spots = new Map<string, Spot>();
  const ordered = [...items].sort((a, b) => a.priority - b.priority);
  for (const item of ordered) {
    const options = candidates(item.px, item.py, item.text.length * CHAR_W);
    const free = options.find((option) => !placed.some((box) => overlaps(box, option.box))) ?? options[0];
    placed.push(free.box);
    spots.set(item.key, free.spot);
  }
  return spots;
}

/** Demand met (vertical) against total cost to serve (horizontal), one line per policy over its knob. */
export function FrontierChart({ points }: { points: FrontierPoint[] }) {
  const xTicks = niceTicks(
    Math.min(...points.map((p) => p.cost_to_serve_inr)),
    Math.max(...points.map((p) => p.cost_to_serve_inr)),
    5,
  );
  const yTicks = niceTicks(
    Math.min(...points.map((p) => p.fill_rate * 100)),
    Math.max(...points.map((p) => p.fill_rate * 100)),
    5,
  );
  const xMin = xTicks[0] ?? 0;
  const xMax = xTicks[xTicks.length - 1] ?? 1;
  const yMin = yTicks[0] ?? 0;
  const yMax = yTicks[yTicks.length - 1] ?? 100;
  const x = linearScale(xMin, xMax, L, W - R);
  const y = linearScale(yMin, yMax, H - B, T);
  const policies = [...new Set(points.map((p) => p.policy))];
  const paramOf = (policy: PolicyName) => points.find((p) => p.policy === policy)?.param ?? "";

  // Labels are placed greedily: the default setting first, then the rest, each at the first candidate spot that does not
  // overlap a label already placed. If none is free, the first candidate is used.
  const placed = placeLabels(
    points.map((p) => ({
      key: `${p.policy}-${p.value}`,
      text: knobLabel(p.param, p.value),
      px: x(p.cost_to_serve_inr),
      py: y(p.fill_rate * 100),
      priority: isDefaultKnob(p.param, p.value) ? 0 : 1,
    })),
  );

  return (
    <>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Demand met against total cost to serve, one line per policy">
          {xTicks.map((v) => (
            <g key={`x${v}`}>
              <line x1={x(v)} x2={x(v)} y1={T} y2={H - B} className={styles.grid} />
              <text x={x(v)} y={H - B + 16} textAnchor="middle">
                {formatRupees(v)}
              </text>
            </g>
          ))}
          {yTicks.map((v) => (
            <g key={`y${v}`}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={styles.grid} />
              <text x={L - 8} y={y(v) + 4} textAnchor="end">
                {`${v}%`}
              </text>
            </g>
          ))}
          <text x={(L + W - R) / 2} y={H - 12} textAnchor="middle">
            Total cost to serve (lower is better)
          </text>
          <text transform={`translate(18 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle">
            Demand met (higher is better)
          </text>

          {policies.map((policy) => {
            const colour = policyColour(policy);
            const plotted = points
              .filter((p) => p.policy === policy)
              .sort((a, b) => a.value - b.value)
              .map((p) => ({ ...p, px: x(p.cost_to_serve_inr), py: y(p.fill_rate * 100) }));
            return (
              <g key={policy}>
                <polyline
                  points={polylinePoints(plotted.map((p) => ({ x: p.px, y: p.py })))}
                  fill="none"
                  strokeWidth={2}
                  style={{ stroke: colour }}
                />
                {plotted.map((p) => {
                  const spot = placed.get(`${policy}-${p.value}`);
                  return (
                    <g key={`${policy}-${p.value}`}>
                      {isDefaultKnob(p.param, p.value) && (
                        <circle cx={p.px} cy={p.py} r={8} fill="none" strokeWidth={1.5} style={{ stroke: colour }} />
                      )}
                      <circle cx={p.px} cy={p.py} r={4} style={{ fill: colour }}>
                        <title>
                          {`${POLICY_LABEL[policy]}, ${KNOB_NAME[p.param] ?? p.param} ${knobLabel(p.param, p.value)}: demand met ${(p.fill_rate * 100).toFixed(1)}%, cost to serve ${formatRupees(p.cost_to_serve_inr)}`}
                        </title>
                      </circle>
                      {spot && (
                        <text x={spot.x} y={spot.y} textAnchor={spot.anchor}>
                          {knobLabel(p.param, p.value)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="legend">
        {policies.map((policy) => (
          <span key={policy} className="legend-item">
            <i className="legend-swatch" style={{ background: policyColour(policy) }} />
            {POLICY_LABEL[policy]}: {KNOB_NAME[paramOf(policy)] ?? paramOf(policy)}
          </span>
        ))}
        <span className="legend-item">
          <i className={styles.ring} />
          Larger ring: default setting
        </span>
      </div>
    </>
  );
}
