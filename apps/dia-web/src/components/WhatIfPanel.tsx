/** What-if (PRD FR-19): re-solve the current cycle with a demand shock, a depot outage or a diesel change. The result stays in this panel; it is never saved as the plan and cannot be published. */
import type { ExpectedKpis, Plan, WhatIf } from "@dia/types";
import { useState } from "react";
import { api, inr } from "../api";
import { ErrorText, useLoad } from "./ui";

const ROWS: Array<{ label: string; key: keyof ExpectedKpis; unit: "inr" | "cases" }> = [
  { label: "Total cost to serve", key: "total_inr", unit: "inr" },
  { label: "Freight", key: "freight_inr", unit: "inr" },
  { label: "Lost margin", key: "lost_margin_inr", unit: "inr" },
  { label: "Expiry", key: "expiry_inr", unit: "inr" },
  { label: "Cases shipped", key: "cases", unit: "cases" },
];

const fmtValue = (v: number, unit: "inr" | "cases") => (unit === "inr" ? inr(v) : Math.round(v).toLocaleString("en-IN"));
const fmtDiff = (v: number, unit: "inr" | "cases") => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtValue(Math.abs(v), unit)}`;

function describeWhatIf(w: WhatIf, depots: Array<{ node_id: string; city: string }>): string {
  const parts: string[] = [];
  if (w.demand_shock_pct) parts.push(`demand ${w.demand_shock_pct > 0 ? "+" : ""}${w.demand_shock_pct}%${w.shock_region ? ` in region ${w.shock_region}` : " in all regions"}`);
  if (w.depot_outage_id) parts.push(`${depots.find((d) => d.node_id === w.depot_outage_id)?.city ?? w.depot_outage_id} depot down`);
  if (w.diesel_pct) parts.push(`diesel ${w.diesel_pct > 0 ? "+" : ""}${w.diesel_pct}%`);
  return parts.length ? parts.join(", ") : "no change";
}

export function WhatIfPanel({ plan }: { plan: Plan }) {
  const scenario = useLoad(() => api.scenario(plan.scenario_id), [plan.scenario_id]);
  const nodes = scenario.data?.nodes ?? [];
  const regions = [...new Set(nodes.map((n) => n.region))].sort();
  const depots = nodes.filter((n) => n.type === "depot");

  const [shock, setShock] = useState(0);
  const [region, setRegion] = useState("");
  const [outage, setOutage] = useState("");
  const [diesel, setDiesel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [applied, setApplied] = useState<WhatIf | null>(null);
  const [result, setResult] = useState<Plan | null>(null);

  async function run() {
    const whatIf: WhatIf = { demand_shock_pct: shock, shock_region: region || null, depot_outage_id: outage || null, diesel_pct: diesel };
    setBusy(true); setError(undefined); setResult(null);
    try {
      const r = await api.createPlan({
        scenario_id: plan.scenario_id, as_of: plan.as_of, temp_class: plan.temp_class,
        weights: { pi_mult: 1, omega_mult: 1, carbon_inr_per_kg: 0 }, locks: [], what_if: whatIf,
      });
      setResult(r);
      setApplied(whatIf);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  const cur: ExpectedKpis = plan.expected_kpis ?? {};
  const alt: ExpectedKpis = result?.expected_kpis ?? {};
  return (
    <>
      <h2>What-if</h2>
      <p className="muted">Re-solve this cycle with a change. The result is shown here only. It is not saved as the plan and cannot be sent to distributors.</p>
      <div className="card toolbar">
        <label>Demand shock %
          <input type="number" min={-90} max={300} value={shock} onChange={(e) => setShock(Number(e.target.value))} />
        </label>
        <label>Region
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All</option>
            {regions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label>Depot outage
          <select value={outage} onChange={(e) => setOutage(e.target.value)}>
            <option value="">None</option>
            {depots.map((d) => <option key={d.node_id} value={d.node_id}>{d.city}</option>)}
          </select>
        </label>
        <label>Diesel price change %
          <input type="number" min={-50} max={200} value={diesel} onChange={(e) => setDiesel(Number(e.target.value))} />
        </label>
        <button className="primary" disabled={busy} onClick={run}>{busy ? "Solving…" : "Run what-if"}</button>
      </div>
      <ErrorText error={error ?? scenario.error} />
      {applied && result && (
        <>
          <div className="callout"><p>Result for {describeWhatIf(applied, depots)}. The current plan is unchanged.</p></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Measure</th><th className="num">Current plan</th><th className="num">What-if</th><th className="num">Difference</th></tr>
              </thead>
              <tbody>
                {ROWS.map((r) => {
                  const a = cur[r.key] ?? 0, b = alt[r.key] ?? 0;
                  return (
                    <tr key={r.key}>
                      <td>{r.label}</td>
                      <td className="num">{fmtValue(a, r.unit)}</td>
                      <td className="num">{fmtValue(b, r.unit)}</td>
                      <td className="num"><b>{fmtDiff(b - a, r.unit)}</b></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
