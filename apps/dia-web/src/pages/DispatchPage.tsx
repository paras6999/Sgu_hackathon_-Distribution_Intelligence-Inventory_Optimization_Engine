/** J3 Dispatch: truck cards with load meters, first-expiry-first-out pick list, CSV download. */
import type { Plan } from "@dia/types";
import { useState } from "react";
import { api } from "../api";
import { Bar, EmptyState, ErrorText, PageHeader, useLoad } from "../components/ui";

export function DispatchPage({ plan }: { plan: Plan | null }) {
  const [depot, setDepot] = useState("");
  const planId = plan?.plan_id ?? "";
  const d = useLoad(() => (planId ? api.dispatch(planId, depot || undefined) : Promise.resolve(null)), [planId, plan?.version, depot]);
  const header = (actions?: React.ReactNode) => (
    <PageHeader title="Dispatch" sub="What each depot loads, truck by truck. Lines are in pick order, soonest expiry first, so the oldest stock leaves first." actions={actions} />
  );
  if (!plan) return <section>{header()}<EmptyState title="No plan to dispatch">Generate a plan on the Plan tab first.</EmptyState></section>;
  const depots = [...new Set(plan.trucks.map((t) => t.from_id))].sort();

  return (
    <section>
      {header(
        <>
          <label>Depot
            <select value={depot} onChange={(e) => setDepot(e.target.value)}>
              <option value="">All depots</option>
              {depots.map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <a href={api.dispatchCsvUrl(planId, depot || undefined)} style={{ textDecoration: "none" }}><button className="secondary">Download CSV</button></a>
        </>,
      )}
      <ErrorText error={d.error} />
      {(d.data?.trucks ?? []).map(({ truck: t, lines }) => (
        <div key={t.truck_id} className="card truck">
          <div className="truck-h">
            <span className="mono">{t.truck_id}</span>
            <span className="badge info">{t.mode === "FTL" ? `Full truck${t.truck_class ? ` · ${t.truck_class}` : ""}` : "Part load"}</span>
            <span className="route">{t.from_id.split("-")[1] ?? t.from_id} → {t.to_id.split("-")[1] ?? t.to_id}</span>
            <span className="muted">ships {t.ship_date}</span>
            {t.mode === "FTL" && (
              <span className="meters">
                <span>Weight {t.kg_pct.toFixed(0)}%</span><Bar pct={t.kg_pct} label={`Weight ${t.kg_pct.toFixed(0)} percent`} />
                <span>Volume {t.m3_pct.toFixed(0)}%</span><Bar pct={t.m3_pct} label={`Volume ${t.m3_pct.toFixed(0)} percent`} />
              </span>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th className="num">Pick</th><th>Lot</th><th>SKU</th><th>Expiry</th><th className="num">Cases</th></tr></thead>
              <tbody>{lines.map((l, i) => <tr key={l.line_id}><td className="num">{i + 1}</td><td className="mono">{l.lot_id}</td><td>{l.sku_name}</td><td>{l.expiry}</td><td className="num">{l.cases.toLocaleString("en-IN")}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
