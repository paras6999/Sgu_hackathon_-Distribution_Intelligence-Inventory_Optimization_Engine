/** J1 Plan tab (owner: M2). Generate a plan, read reason codes, send to distributors. */
import type { Plan, TempClass } from "@dia/types";
import { useState } from "react";
import { api, inr } from "../api";
import { ErrorText, Kpi, ReasonChips, useLoad } from "../components/ui";

export function PlanPage({ plan, setPlan }: { plan: Plan | null; setPlan: (p: Plan) => void }) {
  const scenarios = useLoad(api.scenarios, []);
  const [scenario, setScenario] = useState("");
  const [asOf, setAsOf] = useState("2025-09-29"); // first test day: the only day with an opening-state snapshot
  const [temp, setTemp] = useState<TempClass>("ambient");
  const [piMult, setPiMult] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState("");

  const sid = scenario || scenarios.data?.[0] || "";

  async function generate() {
    setBusy(true); setError(undefined); setNotice("");
    try {
      setPlan(await api.createPlan({ scenario_id: sid, as_of: asOf, temp_class: temp, weights: { pi_mult: piMult } }));
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  async function publish() {
    if (!plan) return;
    try {
      const r = await api.publish(plan.plan_id, plan.version);
      setNotice(`Sent ${r.messages.length} proposals.`);
    } catch (e) { setError(e); }
  }

  const k = plan?.expected_kpis;
  return (
    <section>
      <div className="row">
        <label>Scenario
          <select value={sid} onChange={(e) => setScenario(e.target.value)}>
            {(scenarios.data ?? []).map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>As of <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
        <label>Temperature class
          <select value={temp} onChange={(e) => setTemp(e.target.value as TempClass)}>
            <option value="ambient">ambient</option>
            <option value="chilled">chilled</option>
          </select>
        </label>
        <label>Stockout weight ×{piMult}
          <input type="range" min={0.25} max={4} step={0.25} value={piMult} onChange={(e) => setPiMult(Number(e.target.value))} />
        </label>
        <button className="primary" disabled={busy || !sid} onClick={generate}>{busy ? "Solving…" : "Generate plan"}</button>
        {plan && <button className="secondary" onClick={publish}>Send to distributors</button>}
      </div>
      <ErrorText error={error ?? scenarios.error} />
      {notice && <p>{notice}</p>}
      {plan && k && (
        <>
          <div className="kpis">
            <Kpi label="Expected cost to serve" value={inr(k.total_inr ?? 0)} />
            <Kpi label="Freight" value={inr(k.freight_inr ?? 0)} />
            <Kpi label="Cases" value={(k.cases ?? 0).toLocaleString("en-IN")} />
            <Kpi label="Solve" value={`${plan.solve.seconds.toFixed(2)} s · ${plan.solve.status}`} />
          </div>
          <p className="mono">Plan {plan.plan_id} v{plan.version}</p>
          <div className="table-wrap card">
            <table>
              <thead><tr><th>Line</th><th>SKU</th><th>Lot</th><th>From → To</th><th>Cases</th><th>Truck</th><th>Life on arrival</th><th>Freight</th><th>Reasons</th><th>Status</th></tr></thead>
              <tbody>
                {plan.lines.map((l) => (
                  <tr key={l.line_id}>
                    <td className="mono">{l.line_id}</td><td>{l.sku_name}</td><td className="mono">{l.lot_id}</td>
                    <td>{l.from_id} → {l.to_id}</td><td>{l.cases}</td><td className="mono">{l.truck_id ?? l.consignment_id}</td>
                    <td>{l.rsl_on_arrival_days} d</td><td>{inr(l.freight_alloc_inr)}</td>
                    <td><ReasonChips reasons={l.reasons} /><div>{l.reasons?.[0]?.detail}</div></td><td>{l.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
