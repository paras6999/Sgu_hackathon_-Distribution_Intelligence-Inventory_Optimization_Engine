/**
 * Warehouses: the planner's live view of the warehouse app (apps/dia-warehouse). How full every depot store and
 * distributor godown is, with counted stock applied, and what depot and distributor staff recorded today.
 * Refreshes itself, so a count or a distributor's answer made on a phone shows here within seconds.
 */
import type { Plan, SpaceNode } from "@dia/types";
import { useEffect } from "react";
import { api } from "../api";
import { EmptyState, ErrorText, Kpi, PageHeader, useLoad } from "../components/ui";

const REFRESH_MS = 15_000;
const DEFAULT_DAY = "2025-09-29";
const KIND_TONE: Record<string, string> = { count: "info", receipt: "ok", adjust: "warn" };

/** Fullness: green below 70%, amber to 90%, red above (the shared Bar treats high as good, as for truck fill). */
function Fullness({ pct }: { pct: number }) {
  const colour = pct >= 90 ? "var(--danger)" : pct >= 70 ? "var(--warning)" : "var(--success)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="bar" role="img" aria-label={`${pct.toFixed(0)} percent full`} style={{ flex: 1 }}>
        <span style={{ width: `${Math.min(100, pct)}%`, background: colour }} />
      </span>
      <span className="num">{pct.toFixed(0)}%</span>
    </div>
  );
}

export function WarehousesPage({ plan }: { plan: Plan | null }) {
  const scenarios = useLoad(api.scenarios, []);
  const sid = plan?.scenario_id ?? scenarios.data?.[0] ?? "";
  const day = plan?.as_of ?? DEFAULT_DAY;
  const space = useLoad(() => (sid ? api.space(sid, day) : Promise.resolve(null)), [sid, day]);
  const feed = useLoad(() => (sid ? api.movements(sid, day) : Promise.resolve([])), [sid, day]);
  const scenario = useLoad(() => (sid ? api.scenario(sid) : Promise.resolve(null)), [sid]);

  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === "visible") { space.reload(); feed.reload(); } }, REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sid, day]);

  const appUrl = `${window.location.protocol}//${window.location.hostname}:3002`;
  const header = (
    <PageHeader
      title="Warehouses"
      sub={<>Live from the warehouse app that depot and distributor staff use on their phones: space at every store and godown, counted stock included, and what they recorded on {day}. Refreshes every 15 seconds.</>}
      actions={<button onClick={() => window.open(appUrl, "_blank", "noopener")}>Open warehouse app</button>}
    />
  );
  if (!sid) return <section>{header}<ErrorText error={scenarios.error} /></section>;

  const rep = space.data;
  const city = (id: string) => scenario.data?.nodes.find((n) => n.node_id === id)?.city ?? id;
  const home = (id: string) => scenario.data?.nodes.find((n) => n.node_id === id)?.home_depot_id;
  const full = (ns: SpaceNode[]) => ns.filter((n) => n.used_pct >= 90).length;
  const moves = feed.data ?? [];
  const counted = new Set(moves.filter((m) => m.kind !== "receipt").map((m) => `${m.node_id}|${m.sku_id}`)).size;

  return (
    <section>
      {header}
      <ErrorText error={space.error ?? feed.error} />
      {rep && (
        <div className="kpis">
          <Kpi label="Depot stores 90%+ full" value={`${full(rep.depots)} of ${rep.depots.length}`} hint="ambient stores and cold rooms" />
          <Kpi label="Godowns 90%+ full" value={`${full(rep.distributors)} of ${rep.distributors.length}`} hint="distributor storage" />
          <Kpi label="Entries today" value={String(moves.length)} hint="receipts, counts and adjustments" />
          <Kpi label="Products counted" value={String(counted)} hint="counted stock replaces the system figure in plans" />
        </div>
      )}

      <h2>Depot stores</h2>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table>
          <thead><tr><th>Depot</th><th>Store</th><th className="num">Cases</th><th className="num">Used m³</th><th className="num">Free m³</th><th>Full</th></tr></thead>
          <tbody>
            {(rep?.depots ?? []).map((n) => (
              <tr key={`${n.node_id}-${n.temp_class}`}>
                <td>{n.city}</td><td>{n.temp_class === "chilled" ? "Cold room" : "Ambient"}</td>
                <td className="num">{n.cases.toLocaleString("en-IN")}</td><td className="num">{n.used_m3}</td><td className="num">{n.free_m3}</td>
                <td style={{ minWidth: 180 }}><Fullness pct={n.used_pct} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Distributor godowns</h2>
      <div className="table-wrap scroll" style={{ marginTop: 10 }}>
        <table>
          <thead><tr><th>Distributor</th><th>Served from</th><th className="num">Cases</th><th className="num">Used m³</th><th className="num">Free m³</th><th>Full</th></tr></thead>
          <tbody>
            {[...(rep?.distributors ?? [])].sort((a, b) => b.used_pct - a.used_pct).map((n) => (
              <tr key={n.node_id}>
                <td>{n.city}</td><td>{city(home(n.node_id) ?? "")}</td>
                <td className="num">{n.cases.toLocaleString("en-IN")}</td><td className="num">{n.used_m3}</td><td className="num">{n.free_m3}</td>
                <td style={{ minWidth: 180 }}><Fullness pct={n.used_pct} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Recorded in the warehouse app today</h2>
      {moves.length === 0 ? (
        <div style={{ marginTop: 10 }}><EmptyState title="Nothing recorded yet">Counts, receipts and adjustments that staff save in the app appear here.</EmptyState></div>
      ) : (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <thead><tr><th>Time</th><th>Warehouse</th><th>What</th><th>Product</th><th className="num">Cases</th><th>By</th><th>Note</th></tr></thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.movement_id}>
                  <td className="mono">{new Date(m.ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{city(m.node_id)}</td>
                  <td><span className={`badge ${KIND_TONE[m.kind] ?? ""}`}>{m.kind}</span></td>
                  <td>{m.sku_name}</td>
                  <td className="num">{m.kind === "adjust" && m.cases > 0 ? "+" : ""}{m.cases.toLocaleString("en-IN")}</td>
                  <td className="mono">{m.user_id}</td>
                  <td className="muted">{m.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
