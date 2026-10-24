/**
 * Network map on a real basemap (FR-14). MapLibre GL with OpenStreetMap raster tiles when online. Lanes and nodes are
 * drawn by us (GeoJSON and DOM markers), so with the network off the map still shows every lane over a plain background;
 * if WebGL is unavailable `onUnsupported` is called and the page shows the SVG map instead.
 */
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef } from "react";

// Vite serves the worker from a different path than MapLibre expects, so point it at the bundled file.
maplibregl.setWorkerUrl(workerUrl);

export interface MapNode { id: string; city: string; lat: number; lon: number; depot: boolean }
export interface MapLane { key: string; from: string; to: string; cases: number; code: string }

export const CODE_COLOUR: Record<string, string> = {
  CHEAPEST_SOURCE: "#1565c0", EXPIRY_PUSH: "#c62828", CLIFF_RESCUE: "#8e0000", FTL_TOPUP: "#00897b",
  FESTIVAL_UPLIFT: "#e07b00", WEATHER_SHIFT: "#039be5",
};
const OTHER = "#7b8794";

/** Quadratic curve between two nodes as a polyline (bends to one side, so opposite lanes do not overlap). */
function curve(a: MapNode, b: MapNode): [number, number][] {
  const mx = (a.lon + b.lon) / 2 + (b.lat - a.lat) * 0.1, my = (a.lat + b.lat) / 2 - (b.lon - a.lon) * 0.1;
  return Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    return [(1 - t) ** 2 * a.lon + 2 * (1 - t) * t * mx + t * t * b.lon, (1 - t) ** 2 * a.lat + 2 * (1 - t) * t * my + t * t * b.lat];
  });
}

export function NetworkMap({ nodes, lanes, selected, onSelect, onUnsupported }: {
  nodes: MapNode[]; lanes: MapLane[]; selected: string | null; onSelect: (key: string | null) => void; onUnsupported: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const markers = useRef<maplibregl.Marker[]>([]);
  const latest = useRef({ nodes, lanes, selected, onSelect });
  latest.current = { nodes, lanes, selected, onSelect };

  const draw = () => {
    const m = map.current;
    if (!m || !ready.current) return;
    const { nodes: ns, lanes: ls, selected: sel } = latest.current;
    const byId = new Map(ns.map((n) => [n.id, n]));
    const max = Math.max(...ls.map((l) => l.cases), 1);
    const features = ls.flatMap((l) => {
      const a = byId.get(l.from), b = byId.get(l.to);
      if (!a || !b) return [];
      return [{ type: "Feature" as const, properties: { key: l.key, w: Math.sqrt(l.cases / max), color: CODE_COLOUR[l.code] ?? OTHER, dim: sel && sel !== l.key ? 1 : 0, label: `${a.city} to ${b.city}: ${l.cases} cases` },
        geometry: { type: "LineString" as const, coordinates: curve(a, b) } }];
    });
    (m.getSource("lanes") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
    markers.current.forEach((x) => x.remove());
    markers.current = ns.map((n) => {
      const el = document.createElement("div");
      el.title = n.city;
      el.style.cssText = n.depot
        ? "width:16px;height:16px;background:#6fa8dc;border:2px solid #fff;box-shadow:0 0 0 1px #1f4e79"
        : "width:10px;height:10px;border-radius:50%;background:#9aa5b1;border:2px solid #fff;box-shadow:0 0 0 1px #5f6b7a";
      const label = document.createElement("span");
      label.textContent = n.city;
      label.style.cssText = `position:absolute;left:${n.depot ? 20 : 14}px;top:-3px;white-space:nowrap;font:${n.depot ? "600 12px" : "11px"} system-ui;color:#111;text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff;pointer-events:none`;
      el.appendChild(label);
      return new maplibregl.Marker({ element: el }).setLngLat([n.lon, n.lat]).addTo(m);
    });
  };

  useEffect(() => {
    if (!box.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: box.current, center: [79, 22], zoom: 3.6, attributionControl: { compact: true },
        style: {
          version: 8,
          sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 18, attribution: "© OpenStreetMap contributors" } },
          layers: [{ id: "bg", type: "background", paint: { "background-color": "#dfe6ec" } }, { id: "osm", type: "raster", source: "osm" }],
        },
      });
    } catch {
      onUnsupported();
      return;
    }
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("error", () => { /* tile or network errors are expected offline; the lanes do not need tiles */ });
    m.on("load", () => {
      m.addSource("lanes", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "lanes", type: "line", source: "lanes", layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["get", "w"], 0, 2, 1, 14],
          "line-opacity": ["case", ["==", ["get", "dim"], 1], 0.15, 0.8],
        },
      });
      m.on("click", "lanes", (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => { const k = e.features?.[0]?.properties?.key as string | undefined; if (k) latest.current.onSelect(latest.current.selected === k ? null : k); });
      m.on("mouseenter", "lanes", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "lanes", () => { m.getCanvas().style.cursor = ""; });
      ready.current = true;
      draw();
      const ns = latest.current.nodes;
      if (ns.length) {
        const b = new maplibregl.LngLatBounds();
        ns.forEach((n) => b.extend([n.lon, n.lat]));
        m.fitBounds(b, { padding: 50, animate: false });
      }
    });
    return () => { ready.current = false; markers.current.forEach((x) => x.remove()); m.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(draw, [nodes, lanes, selected]);

  return <div ref={box} role="img" aria-label="Map of depots, distributors and lanes" style={{ width: "100%", height: 520, borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden" }} />;
}
