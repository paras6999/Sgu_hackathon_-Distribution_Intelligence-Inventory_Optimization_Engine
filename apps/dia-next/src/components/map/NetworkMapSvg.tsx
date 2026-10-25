import { formatNumber } from "@/lib/format";
import { laneColour } from "@/lib/mapColors";
import type { MapLane, MapNode } from "./lanes";
import styles from "./map.module.css";

type Props = {
  nodes: MapNode[];
  lanes: MapLane[];
  onSelect: (key: string) => void;
};

// Flat projection over India, used when no basemap can start. x grows east and y grows south.
const LON_ORIGIN = 68;
const LAT_TOP = 36;
const SCALE = 20;
const LON_SQUEEZE = 0.93;

function project(node: MapNode): { x: number; y: number } {
  return {
    x: 20 + (node.lon - LON_ORIGIN) * LON_SQUEEZE * SCALE,
    y: 20 + (LAT_TOP - node.lat) * SCALE,
  };
}

/** Same lanes and colours as the MapLibre map, without tiles. */
export function NetworkMapSvg({ nodes, lanes, onSelect }: Props) {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const max = Math.max(1, ...lanes.map((lane) => lane.cases));

  return (
    <svg viewBox="0 0 600 600" role="img" aria-label="Plan lanes on a map of India" className={styles.frame}>
      {lanes.map((lane) => {
        const a = byId.get(lane.from);
        const b = byId.get(lane.to);
        if (!a || !b) return null;
        const p = project(a);
        const q = project(b);
        const cx = (p.x + q.x) / 2 + (q.y - p.y) * 0.12;
        const cy = (p.y + q.y) / 2 - (q.x - p.x) * 0.12;
        return (
          <path
            key={lane.key}
            d={`M${p.x},${p.y} Q${cx},${cy} ${q.x},${q.y}`}
            fill="none"
            strokeLinecap="round"
            stroke={laneColour(lane.reason)}
            strokeWidth={1 + 12 * Math.sqrt(lane.cases / max)}
            opacity={lane.dim ? 0.12 : 0.65}
            className={styles.lane}
            onClick={() => onSelect(lane.key)}
          >
            <title>{`${a.city} to ${b.city}: ${formatNumber(lane.cases)} cases`}</title>
          </path>
        );
      })}
      {nodes.map((node) => {
        const p = project(node);
        return node.depot ? (
          <g key={node.id}>
            <title>{node.city}</title>
            <rect x={p.x - 7} y={p.y - 7} width={14} height={14} className={styles.svgDepot} />
            {node.showLabel && (
              <text x={p.x + 10} y={p.y + 4} className={styles.svgDepotLabel}>
                {node.city}
              </text>
            )}
          </g>
        ) : (
          <g key={node.id}>
            <title>{node.city}</title>
            <circle cx={p.x} cy={p.y} r={4.5} className={styles.svgDistributor} />
            {node.showLabel && (
              <text x={p.x + 7} y={p.y + 3} className={styles.svgLabel}>
                {node.city}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
