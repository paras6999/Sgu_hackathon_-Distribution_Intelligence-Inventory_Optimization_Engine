"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { reasonLabel } from "@/lib/format";
import { LEGEND_REASONS, OTHER_LANE_COLOUR, REASON_COLOUR } from "@/lib/mapColors";
import type { MapLane, MapNode } from "./lanes";
import { NetworkMapSvg } from "./NetworkMapSvg";
import styles from "./map.module.css";

// MapLibre needs the browser, so the map is loaded only on the client.
const NetworkMap = dynamic(() => import("./NetworkMap").then((m) => m.NetworkMap), {
  ssr: false,
  loading: () => <div className={`${styles.frame} ${styles.placeholder}`}>Loading map…</div>,
});

type Props = {
  nodes: MapNode[];
  lanes: MapLane[];
  onSelect: (key: string) => void;
};

/** The map (MapLibre, or the SVG map when WebGL is missing) and its colour legend. */
export function MapPanel({ nodes, lanes, onSelect }: Props) {
  const [svgOnly, setSvgOnly] = useState(false);

  return (
    <div>
      {svgOnly ? (
        <NetworkMapSvg nodes={nodes} lanes={lanes} onSelect={onSelect} />
      ) : (
        <NetworkMap
          nodes={nodes}
          lanes={lanes}
          onSelect={onSelect}
          onUnsupported={() => setSvgOnly(true)}
        />
      )}
      <div className="legend">
        {LEGEND_REASONS.map((code) => (
          <span key={code} className="legend-item">
            <i className="legend-swatch" style={{ background: REASON_COLOUR[code] }} />
            {reasonLabel(code)}
          </span>
        ))}
        <span className="legend-item">
          <i className="legend-swatch" style={{ background: OTHER_LANE_COLOUR }} />
          Other reasons
        </span>
      </div>
    </div>
  );
}
