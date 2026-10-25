import type { PlanLine, ReasonCode } from "@dia/types";

/**
 * A depot or distributor, with the coordinates the map needs. `showLabel` is false when the name would print
 * over a neighbour's name. The name then shows on hover (the marker title).
 */
export type MapNode = { id: string; city: string; lat: number; lon: number; depot: boolean; showLabel: boolean };

/** Two nodes closer than this many degrees would print their names on top of each other. */
const LABEL_CLASH_DEG = 0.4;

/**
 * Sets `showLabel` on each node. Of two nodes that clash, the smaller one loses its label: a distributor gives
 * way to a depot. Of two nodes of the same kind, the one listed later gives way.
 */
export function withLabelFlags(nodes: Omit<MapNode, "showLabel">[]): MapNode[] {
  return nodes.map((node, i) => {
    const beaten = nodes.some((other, j) => {
      if (j === i || Math.hypot(other.lat - node.lat, other.lon - node.lon) >= LABEL_CLASH_DEG) return false;
      if (other.depot !== node.depot) return other.depot;
      return j < i;
    });
    return { ...node, showLabel: !beaten };
  });
}

/** One lane of the plan: every line from one place to another, added up. */
export type LaneRow = {
  key: string;
  from: string;
  to: string;
  fromName: string;
  toName: string;
  cases: number;
  freight: number;
  /** The reason behind most cases on the lane. Null when no line gives a reason. */
  reason: ReasonCode | null;
  products: { name: string; cases: number }[];
};

/** A lane as the map draws it. `dim` lanes are drawn faint. */
export type MapLane = {
  key: string;
  from: string;
  to: string;
  cases: number;
  reason: ReasonCode | null;
  dim: boolean;
};

export function laneKey(from: string, to: string): string {
  return `${from}>${to}`;
}

function topKey<K>(counts: Map<K, number>): K | null {
  let best: K | null = null;
  let bestCount = -1;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/** Groups plan lines into lanes, largest first. */
export function buildLanes(lines: PlanLine[], cityById: Map<string, string>): LaneRow[] {
  const groups = new Map<
    string,
    { row: LaneRow; reasonCases: Map<ReasonCode, number>; productCases: Map<string, number> }
  >();
  for (const line of lines) {
    const key = laneKey(line.from_id, line.to_id);
    let group = groups.get(key);
    if (!group) {
      group = {
        row: {
          key,
          from: line.from_id,
          to: line.to_id,
          fromName: cityById.get(line.from_id) ?? line.from_id,
          toName: cityById.get(line.to_id) ?? line.to_id,
          cases: 0,
          freight: 0,
          reason: null,
          products: [],
        },
        reasonCases: new Map(),
        productCases: new Map(),
      };
      groups.set(key, group);
    }
    group.row.cases += line.cases;
    group.row.freight += line.freight_alloc_inr;
    group.productCases.set(line.sku_name, (group.productCases.get(line.sku_name) ?? 0) + line.cases);
    const code = line.reasons?.[0]?.code;
    if (code) group.reasonCases.set(code, (group.reasonCases.get(code) ?? 0) + line.cases);
  }
  return [...groups.values()]
    .map(({ row, reasonCases, productCases }) => ({
      ...row,
      reason: topKey(reasonCases),
      products: [...productCases]
        .map(([name, cases]) => ({ name, cases }))
        .sort((a, b) => b.cases - a.cases),
    }))
    .sort((a, b) => b.cases - a.cases);
}
