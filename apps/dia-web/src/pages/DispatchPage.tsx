/** J3 Dispatch (owner: M2). Truck cards with load %, FEFO pick list, CSV download. */
import type { Plan } from "@dia/types";
import { useState } from "react";
import { api } from "../api";
import { ErrorText, useLoad } from "../components/ui";

export function DispatchPage({ plan }: { plan: Plan | null }) {
  const [depot, setDepot] = useState("");
  const planId = plan?.plan_id ?? "";
  const d = useLoad(() => (planId ? api.dispatch(planId, depot || undefined) : Promise.resolve(null)), [planId, plan?.version, depot]);
  if (!plan) return <p>Generate a plan on the Plan tab first.</p>;
  const depots = [...new Set(plan.trucks.map((t) => t.from_id))].sort();

  return (
    <section>
      <div className="row">
        <label>Depot
          <select value={depot} onChange={(e) => setDepot(e.target.value)}>
            <option value="">All depots</option>
            {depots.map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <a className="secondary" href={api.dispatchCsvUrl(planId, depot || undefined)}><button className="secondary">Download CSV</button></a>
      </div>
      <ErrorText error={d.error} />
      {(d.data?.trucks ?? []).map(({ truck: t, lines }) => (
        <div key={t.truck_id} className="card" style={{ margin: "8px 0" }}>
          <b className="mono">{t.truck_id}</b> · {t.mode}{t.truck_class ? ` ${t.truck_class}` : ""} · {t.from_id} → {t.to_id} · ship {t.ship_date}
          {t.mode === "FTL" && <> · kg {t.kg_pct.toFixed(0)}% · m³ {t.m3_pct.toFixed(0)}%</>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Pick #</th><th>Lot</th><th>SKU</th><th>Expiry</th><th>Cases</th></tr></thead>
              <tbody>{lines.map((l, i) => <tr key={l.line_id}><td>{i + 1}</td><td className="mono">{l.lot_id}</td><td>{l.sku_name}</td><td>{l.expiry}</td><td>{l.cases}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
