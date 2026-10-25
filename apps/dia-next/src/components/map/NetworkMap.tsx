"use client";

import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { laneColour } from "@/lib/mapColors";
import type { MapLane, MapNode } from "./lanes";
import styles from "./map.module.css";

// The worker file is served from public/. It must be set before the first map is created.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

const SOURCE = "lanes";
const LAYER = "lanes";

function hasWebgl(): boolean {
  const canvas = document.createElement("canvas");
  return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
}

/** Quadratic curve between two nodes, bent to one side so lanes in opposite directions do not overlap. */
function arc(a: MapNode, b: MapNode): [number, number][] {
  const cx = (a.lon + b.lon) / 2 + (b.lat - a.lat) * 0.1;
  const cy = (a.lat + b.lat) / 2 - (b.lon - a.lon) * 0.1;
  return Array.from({ length: 25 }, (_, i): [number, number] => {
    const t = i / 24;
    const u = 1 - t;
    return [
      u * u * a.lon + 2 * u * t * cx + t * t * b.lon,
      u * u * a.lat + 2 * u * t * cy + t * t * b.lat,
    ];
  });
}

/** Replaces the lane lines. Width follows cases, colour follows the main reason. */
function drawLanes(map: maplibregl.Map, nodes: MapNode[], lanes: MapLane[]) {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const max = Math.max(1, ...lanes.map((lane) => lane.cases));
  const features = lanes.flatMap((lane) => {
    const a = byId.get(lane.from);
    const b = byId.get(lane.to);
    if (!a || !b) return [];
    return [
      {
        type: "Feature" as const,
        properties: {
          key: lane.key,
          width: Math.sqrt(lane.cases / max),
          color: laneColour(lane.reason),
          dim: lane.dim ? 1 : 0,
        },
        geometry: { type: "LineString" as const, coordinates: arc(a, b) },
      },
    ];
  });
  (map.getSource(SOURCE) as maplibregl.GeoJSONSource).setData({
    type: "FeatureCollection",
    features,
  });
}

/** Replaces the depot squares and distributor dots, with their city names. */
function drawNodes(
  map: maplibregl.Map,
  nodes: MapNode[],
  previous: maplibregl.Marker[],
): maplibregl.Marker[] {
  previous.forEach((marker) => marker.remove());
  return nodes.map((node) => {
    const el = document.createElement("div");
    el.className = node.depot ? styles.depot : styles.distributor;
    el.title = node.city;
    if (node.showLabel) {
      const label = document.createElement("span");
      label.className = node.depot ? `${styles.label} ${styles.depotLabel}` : styles.label;
      label.textContent = node.city;
      el.appendChild(label);
    }
    return new maplibregl.Marker({ element: el }).setLngLat([node.lon, node.lat]).addTo(map);
  });
}

type Props = {
  nodes: MapNode[];
  lanes: MapLane[];
  onSelect: (key: string) => void;
  /** Called when no map can start (no WebGL). The page then shows the SVG map. */
  onUnsupported: () => void;
};

/** MapLibre basemap with OpenStreetMap tiles. Lanes and nodes are drawn by us, so they still show without tiles. */
export function NetworkMap({ nodes, lanes, onSelect, onUnsupported }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const loaded = useRef(false);
  const markers = useRef<maplibregl.Marker[]>([]);
  // Map event handlers are registered once, so they read the latest props through this ref.
  const latest = useRef({ nodes, lanes, onSelect, onUnsupported });

  useEffect(() => {
    latest.current = { nodes, lanes, onSelect, onUnsupported };
  });

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    let created: maplibregl.Map;
    try {
      if (!hasWebgl()) throw new Error("WebGL is not available.");
      created = new maplibregl.Map({
        container: el,
        center: [79, 22],
        zoom: 3.6,
        attributionControl: { compact: true },
        style: {
          version: 8,
          sources: {
            osm: {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              maxzoom: 18,
              attribution: "© OpenStreetMap contributors",
            },
          },
          layers: [
            { id: "background", type: "background", paint: { "background-color": "#dfe6ec" } },
            { id: "osm", type: "raster", source: "osm" },
          ],
        },
      });
    } catch {
      latest.current.onUnsupported();
      return;
    }
    map.current = created;
    created.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // style.load fires once the style is parsed, before any OpenStreetMap tile arrives. Lanes and nodes are drawn here,
    // so they show even when the tile server is slow or unreachable. The 'load' event waits for tiles.
    created.on("style.load", () => {
      created.addSource(SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      created.addLayer({
        id: LAYER,
        type: "line",
        source: SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["get", "width"], 0, 2, 1, 14],
          "line-opacity": ["case", ["==", ["get", "dim"], 1], 0.15, 0.8],
        },
      });
      created.on("click", LAYER, (event) => {
        const key = event.features?.[0]?.properties?.key;
        if (typeof key === "string") latest.current.onSelect(key);
      });
      created.on("mouseenter", LAYER, () => {
        created.getCanvas().style.cursor = "pointer";
      });
      created.on("mouseleave", LAYER, () => {
        created.getCanvas().style.cursor = "";
      });

      const { nodes: ns, lanes: ls } = latest.current;
      drawLanes(created, ns, ls);
      markers.current = drawNodes(created, ns, []);
      const bounds = new maplibregl.LngLatBounds();
      ns.forEach((n) => bounds.extend([n.lon, n.lat]));
      created.fitBounds(bounds, { padding: 50, animate: false });
      loaded.current = true;
    });

    return () => {
      loaded.current = false;
      created.remove();
      map.current = null;
      markers.current = [];
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (m && loaded.current) markers.current = drawNodes(m, nodes, markers.current);
  }, [nodes]);

  useEffect(() => {
    const m = map.current;
    if (m && loaded.current) drawLanes(m, nodes, lanes);
  }, [nodes, lanes]);

  return (
    <div
      ref={container}
      className={styles.frame}
      role="img"
      aria-label="Map of depots, distributors and lanes"
    />
  );
}
