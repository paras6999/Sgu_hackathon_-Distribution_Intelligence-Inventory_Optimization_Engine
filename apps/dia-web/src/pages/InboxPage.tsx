/** J2 Distributor inbox (owner: M2). WhatsApp-style proposal; accept / trim / reject; planner change log. */
import type { LineAction, Plan, ResponseAction } from "@dia/types";
import { useState } from "react";
import { api, inr } from "../api";
import { ErrorText, useLoad } from "../components/ui";

export function InboxPage({ plan, setPlan }: { plan: Plan | null; setPlan: (p: Plan) => void }) {
  const planId = plan?.plan_id ?? "";
  const proposals = useLoad(() => (planId ? api.proposals(planId) : Promise.resolve([])), [planId, plan?.version]);
  const [dist, setDist] = useState("");
  const current = dist || proposals.data?.[0]?.dist_id || "";
  const msg = useLoad(() => (planId && current ? api.inbox(planId, current) : Promise.resolve(null)), [planId, current, plan?.version]);
  const events = useLoad(() => (planId ? api.events(planId) : Promise.resolve([])), [planId, plan?.version]);
  const [choices, setChoices] = useState<Record<string, { action: ResponseAction; qty: number }>>({});
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState("");

  if (!plan) return <p>Generate a plan on the Plan tab first.</p>;
  if (proposals.data && proposals.data.length === 0) return <p>Send the plan to distributors first (Plan tab).</p>;

  const lines = plan.lines.filter((l) => msg.data?.line_ids.includes(l.line_id));

  async function send() {
    if (!msg.data) return;
    const actions: LineAction[] = lines.map((l) => {
      const c = choices[l.line_id] ?? { action: "accept", qty: l.cases };
      return { line_id: l.line_id, action: c.action, qty: c.action === "trim" ? c.qty : null };
    });
    try {
      const res = await api.respond(planId, { dist_id: current, proposal_version: msg.data.proposal_version, actions });
      setNotice(`Plan now v${res.plan_version}; Δ expected cost ${inr(res.delta_cost_inr)}; grown: ${res.grown_proposals.join(", ") || "none"}`);
      setChoices({});
      setPlan(await api.plan(planId));   // line ids belong to one version: always re-fetch
    } catch (e) { setError(e); }
  }

  return (
    <section>
      <label>Distributor
        <select value={current} onChange={(e) => setDist(e.target.value)}>
          {(proposals.data ?? []).map((p) => <option key={p.dist_id} value={p.dist_id}>{p.dist_id} · {p.status} · v{p.proposal_version}</option>)}
        </select>
      </label>
      {msg.data && <p className="bubble">{msg.data.text}</p>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>SKU</th><th>Cases</th><th>Life on arrival</th><th>ETA</th><th>Action</th><th>Qty</th></tr></thead>
          <tbody>
            {lines.map((l) => {
              const c = choices[l.line_id] ?? { action: "accept" as ResponseAction, qty: l.cases };
              return (
                <tr key={l.line_id}>
                  <td>{l.sku_name}</td><td>{l.cases}</td><td>{l.rsl_on_arrival_days} d</td><td>{l.eta}</td>
                  <td>
                    <select value={c.action} onChange={(e) => setChoices({ ...choices, [l.line_id]: { ...c, action: e.target.value as ResponseAction } })}>
                      <option value="accept">accept</option><option value="trim">trim</option><option value="reject">reject</option>
                    </select>
                  </td>
                  <td><input type="number" min={0} max={l.cases} value={c.qty} disabled={c.action !== "trim"}
                    onChange={(e) => setChoices({ ...choices, [l.line_id]: { ...c, qty: Number(e.target.value) } })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p><button className="primary" onClick={send} disabled={!lines.length}>Send response</button></p>
      <ErrorText error={error ?? msg.error ?? proposals.error} />
      {notice && <p>{notice}</p>}
      <h2>Change log</h2>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Line</th><th>Old → new</th><th>Δ cost</th></tr></thead>
          <tbody>
            {(events.data ?? []).map((e, i) => (
              <tr key={i}><td>{e.ts.slice(11, 19)}</td><td>{e.actor}</td><td>{e.action}</td><td className="mono">{e.line_id ?? ""}</td>
                <td>{e.old_qty ?? ""} → {e.new_qty ?? ""}</td><td>{inr(e.delta_cost_inr ?? 0)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
