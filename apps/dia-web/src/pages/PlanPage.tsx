/** J1 Plan: generate one cycle, read the reason behind every line, send it to distributors. */
import type { LineStatus, Plan, TempClass } from "@dia/types";
import { useState } from "react";
import { api, inr } from "../api";
import { AnalysisPanel } from "../components/AnalysisPanel";
import { EmptyState, ErrorText, Kpi, PageHeader, ReasonChips, useLoad } from "../components/ui";
import { WhatIfPanel } from "../components/WhatIfPanel";

export const STATUS_TONE: Record<string, string> = { PROPOSED: "info", ACCEPTED: "ok", TRIMMED: "warn", REJECTED: "bad" };
const SOLVE_LABEL: Record<string, string> = { optimal: "Optimal", time_limit: "Best within the time budget", lp_round: "Rounded from the LP relaxation", fallback_baseline_b: "Fell back to Baseline B", not_solved: "Baseline (no solver)" };

const DAY_MS = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Planning days for a temperature class: the test window's first day plus multiples of `planning.cadence_days`
 * (chilled every 2 days, on plant receipt days). Off those days the depots have already shipped their stock.
 */
function planningDays(asOf: string, start: string, cadence: number, end: string) {
  const t = Date.parse(`${asOf}T00:00:00Z`), s = Date.parse(`${start}T00:00:00Z`);
  const off = (((t - s) / DAY_MS) % cadence + cadence) % cadence;
  const prev = isoDay(t - off * DAY_MS), next = isoDay(t + (cadence - off) * DAY_MS);
  return { onCycle: off === 0, prev: prev < start ? null : prev, next: next > end ? null : next };
}

export function PlanPage({ plan, setPlan }: { plan: Plan | null; setPlan: (p: Plan) => void }) {
  const scenarios = useLoad(api.scenarios, []);
  const [scenario, setScenario] = useState("");
  const [asOf, setAsOf] = useState("2025-09-29"); // first test day; any day of the test window works
  const [temp, setTemp] = useState<TempClass>("ambient");
  const [piMult, setPiMult] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState("");

  const sid = scenario || scenarios.data?.[0] || "";
  const assumptions = useLoad(api.assumptions, []);
  const param = (name: string) => assumptions.data?.find((r) => r.parameter === name)?.value;
  const cadence = (param("planning.cadence_days") as Record<string, number> | undefined)?.[temp];
  const [winStart = "2025-09-29", winEnd = "2025-12-21"] = (param("simulation.test_window") as string[] | undefined) ?? [];
  // Only chilled stock runs out between cycles (short life, receipts every cadence days); ambient depots keep stock.
  const cycle = temp === "chilled" && cadence && cadence > 1 ? planningDays(asOf, winStart, cadence, winEnd) : null;

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
      setNotice(`Sent ${r.messages.length} proposals to distributors. Open Distributor inbox to respond.`);
    } catch (e) { setError(e); }
  }

  const k = plan?.expected_kpis;
  const total = k?.total_inr ?? 0;
  return (
    <section>
      <PageHeader
        title="Plan"
        sub="Generate one planning cycle. Every line shows why it is there, in rupees, so a planner can accept it or challenge it."
        actions={plan && <button className="secondary" onClick={publish}>Send to distributors</button>}
      />
      <div className="card toolbar">
        <label>Scenario
          <select value={sid} onChange={(e) => setScenario(e.target.value)}>
            {(scenarios.data ?? []).map((s) => <option key={s}>{s}</option>)}
          </select>
        </label>
        <label>As of
          <input type="date" value={asOf} min="2025-09-29" max="2025-12-21" onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <label>Temperature class
          <select value={temp} onChange={(e) => setTemp(e.target.value as TempClass)}>
            <option value="ambient">Ambient</option>
            <option value="chilled">Chilled</option>
          </select>
        </label>
        <label className="grow">Stockout weight ×{piMult}
          <input type="range" min={0.25} max={4} step={0.25} value={piMult} onChange={(e) => setPiMult(Number(e.target.value))} />
        </label>
        <button className="primary" disabled={busy || !sid} onClick={generate}>{busy ? "Solving…" : "Generate plan"}</button>
      </div>
      <ErrorText error={error ?? scenarios.error} />
      {cycle && !cycle.onCycle && (
        <div className="callout warn" role="status">
          <h3>{fmtDay(asOf)} is not a {temp} planning day</h3>
          <p>Chilled stock arrives from the plants every {cadence} days, and each planning day ships what arrived. On other days the depots hold almost nothing, so a plan here ships little and counts the gap as lost sales.</p>
          <div className="row" style={{ marginTop: 8 }}>
            {cycle.prev && <button onClick={() => setAsOf(cycle.prev!)}>Use {fmtDay(cycle.prev)}</button>}
            {cycle.next && <button onClick={() => setAsOf(cycle.next!)}>Use {fmtDay(cycle.next)}</button>}
          </div>
        </div>
      )}
      {notice &&<div className="callout" role="status"><p>{notice}</p></div>}

      {!plan && !busy && (
        <div style={{ marginTop: 16 }}>
          <EmptyState title="No plan yet">Choose a date in the test window and a temperature class, then select Generate plan. The solve takes a few seconds.</EmptyState>
        </div>
      )}

      {plan && k && (
        <>
          <div className="kpis">
            <Kpi label="Expected cost to serve" value={inr(total)} hint="Freight, lost margin, holding and expiry" />
            <Kpi label="Freight" value={inr(k.freight_inr ?? 0)} hint={total ? `${Math.round((100 * (k.freight_inr ?? 0)) / total)}% of cost to serve` : undefined} />
            <Kpi label="Cases shipped" value={(k.cases ?? 0).toLocaleString("en-IN")} hint={`${plan.lines.length} lines on ${plan.trucks.length} trucks`} />
            <Kpi label="Solve" value={`${plan.solve.seconds.toFixed(1)} s`} hint={SOLVE_LABEL[plan.solve.status] ?? plan.solve.status} />
          </div>
          <WhatIfPanel key={`${plan.plan_id}-${plan.version}`} plan={plan} />
          <AnalysisPanel title="Analysis of this plan" request={{ kind: "plan", plan_id: plan.plan_id, version: plan.version }} />
          <h2>Plan lines <span className="muted" style={{ fontWeight: 400 }}>· {plan.plan_id} v{plan.version}</span></h2>
          <div className="table-wrap scroll" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr><th>SKU</th><th>From → to</th><th className="num">Cases</th><th>Truck</th><th className="num">Life left</th><th className="num">Freight</th><th>Why</th><th>Status</th></tr>
              </thead>
              <tbody>
                {plan.lines.map((l) => (
                  <tr key={l.line_id}>
                    <td><div>{l.sku_name}</div><div className="mono muted">{l.lot_id}</div></td>
                    <td style={{ whiteSpace: "nowrap" }}>{l.from_id.split("-")[1] ?? l.from_id} → {l.to_id.split("-")[1] ?? l.to_id}</td>
                    <td className="num">{l.cases.toLocaleString("en-IN")}</td>
                    <td className="mono">{l.truck_id ?? l.consignment_id}</td>
                    <td className="num">{l.rsl_on_arrival_days} d</td>
                    <td className="num">{inr(l.freight_alloc_inr)}</td>
                    <td><ReasonChips reasons={l.reasons} /><div className="cell-sub">{l.reasons?.[0]?.detail}</div></td>
                    <td><span className={`badge ${STATUS_TONE[l.status as LineStatus] ?? ""}`}>{l.status}</span></td>
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
