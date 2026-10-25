"use client";

import { useCallback, useMemo, useState } from "react";
import type { UiAction } from "@dia/types";
import { LaneDetail } from "@/components/map/LaneDetail";
import { LaneTable } from "@/components/map/LaneTable";
import { MapPanel } from "@/components/map/MapPanel";
import {
  buildLanes,
  laneKey,
  withLabelFlags,
  type LaneRow,
  type MapLane,
  type MapNode,
} from "@/components/map/lanes";
import styles from "@/components/map/map.module.css";
import { useApp } from "@/context/AppContext";
import { usePageContext } from "@/hooks/usePageContext";
import { useScenario } from "@/hooks/useScenario";
import { useUiActions } from "@/hooks/useUiActions";

const QUICK_PROMPTS = ["Which lane carries the most cases?", "Show only Dankuni lanes"];

/**
 * `from` and `to` are the filter the assistant or the user set. `selected` is the lane
 * clicked on the map or in the table. Both use node ids.
 */
type View = { from: string | null; to: string | null; selected: string | null };

const NO_VIEW: View = { from: null, to: null, selected: null };

/** The assistant may send a node id or a city name. Unknown values are kept as they are. */
function nodeIdFor(value: string | undefined, nodes: MapNode[]): string | null {
  if (!value) return null;
  const wanted = value.trim().toLowerCase();
  const node = nodes.find((n) => n.id.toLowerCase() === wanted || n.city.toLowerCase() === wanted);
  return node ? node.id : value;
}

/** A lane is inside the filter when each filled end matches. An empty end matches every lane. */
function inFilter(lane: LaneRow, view: View): boolean {
  return (view.from === null || lane.from === view.from) && (view.to === null || lane.to === view.to);
}

export default function MapPage() {
  const { plan, loading: planLoading } = useApp();
  const { scenario, error: scenarioError, loading: scenarioLoading } = useScenario();
  const [view, setView] = useState<View>(NO_VIEW);

  const nodes = useMemo<MapNode[]>(
    () =>
      withLabelFlags(
        (scenario?.nodes ?? []).map((n) => ({
          id: n.node_id,
          city: n.city,
          lat: n.lat,
          lon: n.lon,
          depot: n.type === "depot",
        })),
      ),
    [scenario],
  );
  const cityById = useMemo(
    () => new Map<string, string>((scenario?.nodes ?? []).map((n): [string, string] => [n.node_id, n.city])),
    [scenario],
  );
  const lanes = useMemo(() => buildLanes(plan?.lines ?? [], cityById), [plan, cityById]);

  const selectedLane = lanes.find((lane) => lane.key === view.selected) ?? null;
  const selectedKey = selectedLane?.key ?? null;
  const rows = useMemo(() => lanes.filter((lane) => inFilter(lane, view)), [lanes, view]);
  const mapLanes = useMemo<MapLane[]>(
    () =>
      lanes.map((lane) => ({
        key: lane.key,
        from: lane.from,
        to: lane.to,
        cases: lane.cases,
        reason: lane.reason,
        dim: !inFilter(lane, view) || (selectedKey !== null && selectedKey !== lane.key),
      })),
    [lanes, view, selectedKey],
  );

  const selectLane = useCallback(
    (key: string) => setView((prev) => ({ ...prev, selected: prev.selected === key ? null : key })),
    [],
  );

  const onAssistantAction = useCallback(
    (action: UiAction) => {
      if (action.type !== "select_lane") return;
      const from = nodeIdFor(action.lane_from, nodes);
      const to = nodeIdFor(action.lane_to, nodes);
      setView({ from, to, selected: from && to ? laneKey(from, to) : null });
    },
    [nodes],
  );
  useUiActions(onAssistantAction);

  usePageContext({
    page: "map",
    context: {
      lane_from: selectedLane?.from ?? view.from ?? undefined,
      lane_to: selectedLane?.to ?? view.to ?? undefined,
    },
    prompts: QUICK_PROMPTS,
  });

  const filterParts: string[] = [];
  if (view.from) filterParts.push(`from ${cityById.get(view.from) ?? view.from}`);
  if (view.to) filterParts.push(`to ${cityById.get(view.to) ?? view.to}`);
  const hasView = view.from !== null || view.to !== null || view.selected !== null;
  const ready = !planLoading && !scenarioLoading;

  return (
    <section className="record" data-page="map" data-ready={ready ? "true" : "false"}>
      <div className="record-head">
        <div>
          <div className="kind">Planning cycle</div>
          <h1>Network map</h1>
          <p className="hint">
            {plan
              ? `Version ${plan.version} · lane width shows cases · colour shows the main reason`
              : "Lane width shows cases · colour shows the main reason"}
          </p>
        </div>
        <span className="spacer" />
        {filterParts.length > 0 && <span className="pill">Showing lanes {filterParts.join(", ")}</span>}
        {hasView && (
          <button type="button" className="btn small" onClick={() => setView(NO_VIEW)}>
            Show all lanes
          </button>
        )}
      </div>

      <div className={styles.body}>
        {!plan ? (
          <p className="empty">{planLoading ? "Loading the plan…" : "Create a plan on Planning first."}</p>
        ) : scenarioError ? (
          <p className="notice error">{scenarioError}</p>
        ) : nodes.length === 0 ? (
          <p className="empty">{scenarioLoading ? "Loading the network…" : "The network is not available."}</p>
        ) : (
          <>
            <MapPanel nodes={nodes} lanes={mapLanes} onSelect={selectLane} />
            <LaneTable rows={rows} selected={selectedKey} onSelect={selectLane} />
            <LaneDetail lane={selectedLane} />
          </>
        )}
      </div>
    </section>
  );
}
