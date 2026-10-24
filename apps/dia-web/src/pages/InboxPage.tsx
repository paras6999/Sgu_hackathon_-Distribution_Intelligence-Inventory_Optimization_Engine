/** J2 Distributor inbox: a proposal as a message, accept / trim / reject per line, and the planner's change log. */
import type { LineAction, Plan, ResponseAction } from "@dia/types";
import { useState } from "react";
import { api, inr } from "../api";
import { EmptyState, ErrorText, PageHeader, useLoad } from "../components/ui";
const EVENT_TONE: Record<string, string> = { accept: "ok", trim: "warn", reject: "bad", grow: "info", publish: "info" };

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
  const header = <PageHeader title="Distributor inbox" sub="Each distributor receives its own proposal. A trim or rejection re-plans the cycle without disturbing distributors who have already answered." />;

  if (!plan) return <section>{header}<EmptyState title="No plan yet">Generate a plan on the Plan tab first.</EmptyState></section>;
  if (proposals.data && proposals.data.length === 0) return <section>{header}<EmptyState title="Nothing sent yet">Select Send to distributors on the Plan tab to create the proposals.</EmptyState></section>;

  const lines = plan.lines.filter((l) => msg.data?.line_ids.includes(l.line_id));

  async function send() {
    if (!msg.data) return;
    const actions: LineAction[] = lines.map((l) => {
      const c = choices[l.line_id] ?? { action: "accept", qty: l.cases };
      return { line_id: l.line_id, action: c.action, qty: c.action === "trim" ? c.qty : null };
    });
    try {
      const res = await api.respond(planId, { dist_id: current, proposal_version: msg.data.proposal_version, actions });
      setNotice(`Plan is now v${res.plan_version}. Expected cost changed by ${inr(res.delta_cost_inr)}. Proposals grown: ${res.grown_proposals.join(", ") || "none"}.`);
      setChoices({});
      setPlan(await api.plan(planId));   // line ids belong to one version: always re-fetch
    } catch (e) { setError(e); }
  }

  return (
    <section>
      {header}
      <div className="card toolbar">
        <label className="grow">Distributor
          <select value={current} onChange={(e) => setDist(e.target.value)}>
            {(proposals.data ?? []).map((p) => <option key={p.dist_id} value={p.dist_id}>{p.dist_id} · {p.status} · v{p.proposal_version}</option>)}
          </select>
        </label>
        <button className="primary" onClick={send} disabled={!lines.length}>Send response</button>
      </div>
      {msg.data && <p className="bubble">{msg.data.text}</p>}
      <div className="table-wrap">
        <table>
          <thead><tr><th>SKU</th><th className="num">Cases</th><th className="num">Life on arrival</th><th>ETA</th><th>Action</th><th className="num">Quantity</th></tr></thead>
          <tbody>
            {lines.map((l) => {
              const c = choices[l.line_id] ?? { action: "accept" as ResponseAction, qty: l.cases };
              return (
                <tr key={l.line_id}>
                  <td>{l.sku_name}</td><td className="num">{l.cases.toLocaleString("en-IN")}</td><td className="num">{l.rsl_on_arrival_days} d</td><td>{l.eta}</td>
                  <td>
                    <select aria-label={`Action for ${l.sku_name}`} value={c.action} onChange={(e) => setChoices({ ...choices, [l.line_id]: { ...c, action: e.target.value as ResponseAction } })}>
                      <option value="accept">Accept</option><option value="trim">Trim</option><option value="reject">Reject</option>
                    </select>
                  </td>
                  <td className="num"><input type="number" aria-label={`Trimmed quantity for ${l.sku_name}`} style={{ width: 90 }} min={0} max={l.cases} value={c.qty} disabled={c.action !== "trim"}
                    onChange={(e) => setChoices({ ...choices, [l.line_id]: { ...c, qty: Number(e.target.value) } })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ErrorText error={error ?? msg.error ?? proposals.error} />
      {notice && <div className="callout" role="status"><p>{notice}</p></div>}
      <h2>Change log</h2>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table>
          <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Line</th><th className="num">Cases</th><th className="num">Δ cost</th></tr></thead>
          <tbody>
            {(events.data ?? []).map((e, i) => (
              <tr key={i}>
                <td className="mono">{e.ts.slice(11, 19)}</td><td>{e.actor}</td>
                <td><span className={`badge ${EVENT_TONE[e.action] ?? ""}`}>{e.action}</span></td>
                <td className="mono">{e.line_id ?? ""}</td>
                <td className="num">{e.old_qty ?? ""} → {e.new_qty ?? ""}</td><td className="num">{inr(e.delta_cost_inr ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
