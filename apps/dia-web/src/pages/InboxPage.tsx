/** J2 Orders by city: one order per distributor; open a city to read its proposal and accept / trim / reject per line. */
import type { LineAction, OrderSummary, Plan, ResponseAction } from "@dia/types";
import { useEffect, useState } from "react";
import { api, inr } from "../api";
import { EmptyState, ErrorText, Kpi, PageHeader, useLoad } from "../components/ui";
const EVENT_TONE: Record<string, string> = { accept: "ok", trim: "warn", reject: "bad", grow: "info", publish: "info" };
const STATUS_TONE: Record<string, string> = { PROPOSED: "info", ACCEPTED: "ok", TRIMMED: "warn", REJECTED: "bad" };
const CREDIT_FULL_PCT = 99.5;
const SUB = "One order per distributor. Select a city to see its proposal and answer it line by line. A trim or rejection re-plans the cycle without disturbing distributors who have already answered.";

export function InboxPage({ plan, setPlan }: { plan: Plan | null; setPlan: (p: Plan) => void }) {
  const planId = plan?.plan_id ?? "";
  const orders = useLoad(() => (planId ? api.orders(planId) : Promise.resolve(null)), [planId, plan?.version]);
  const events = useLoad(() => (planId ? api.events(planId) : Promise.resolve([])), [planId, plan?.version]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<unknown>();
  const [notice, setNotice] = useState("");
  const header = <PageHeader title="Orders by city" sub={SUB} />;

  // Distributors also answer from the warehouse app: re-read the orders, and the plan once its version moves on.
  useEffect(() => {
    if (!planId) return;
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      orders.reload(); events.reload();
      try {
        const latest = await api.plan(planId);
        if (latest.version !== plan?.version) setPlan(latest);
      } catch { /* keep the current view */ }
    }, 15_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, plan?.version]);

  if (!plan) return <section>{header}<EmptyState title="No plan yet">Generate a plan on the Plan tab first.</EmptyState></section>;

  const view = orders.data;
  const list = [...(view?.orders ?? [])].sort((a, b) => b.value_inr - a.value_inr);
  const sent = list.some((o) => o.proposal_version >= 1);
  const t = view?.totals;

  async function publish() {
    if (!plan) return;
    try {
      const r = await api.publish(plan.plan_id, plan.version);
      setNotice(`Sent ${r.messages.length} proposals to distributors.`);
      setPlan(await api.plan(plan.plan_id));
      orders.reload(); events.reload();   // publishing keeps the plan version, so refresh explicitly
    } catch (e) { setError(e); }
  }

  return (
    <section>
      <PageHeader
        title="Orders by city"
        sub={SUB}
        actions={!sent && list.length > 0 && <button className="primary" onClick={publish}>Send {list.length} orders to distributors</button>}
      />
      {t && (
        <div className="kpis">
          <Kpi label="Orders" value={String(t.orders)} hint="one per distributor" />
          <Kpi label="Replied" value={`${t.replied} of ${t.orders}`} hint={`${t.orders - t.replied} waiting`} />
          <Kpi label="Lines" value={t.lines.toLocaleString("en-IN")} hint={`draft had ${t.draft_lines.toLocaleString("en-IN")}`} />
          <Kpi label="Cases" value={t.cases.toLocaleString("en-IN")} hint={`draft had ${t.draft_cases.toLocaleString("en-IN")}`} />
          <Kpi label="Order value" value={inr(t.value_inr)} hint={`Credit available ${inr(t.credit_available_inr)}`} />
          <Kpi label="Credit used" value={`${t.credit_used_pct.toFixed(1)}%`} hint={`${list.filter((o) => o.credit_used_pct >= CREDIT_FULL_PCT).length} orders at ${CREDIT_FULL_PCT}% or more`} />
        </div>
      )}
      {!sent && list.length > 0 && <div className="callout"><p>This is a draft: the orders are not sent yet. You can open a city to read its lines; answering needs the orders to be sent first.</p></div>}
      {notice && <div className="callout" role="status"><p>{notice}</p></div>}
      <ErrorText error={error ?? orders.error} />

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table>
          <thead><tr><th>City</th><th>Status</th><th className="num">Lines</th><th className="num">Cases</th><th className="num">Value</th><th>Credit used</th><th className="num">Since draft</th></tr></thead>
          <tbody>
            {list.map((o) => (
              <OrderRow key={o.dist_id} order={o} plan={plan} open={open === o.dist_id} onToggle={() => setOpen(open === o.dist_id ? null : o.dist_id)}
                onAnswered={async (text) => { setNotice(text); setPlan(await api.plan(planId)); orders.reload(); events.reload(); }} onError={setError} />
            ))}
          </tbody>
        </table>
      </div>

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

function OrderRow({ order: o, plan, open, onToggle, onAnswered, onError }: {
  order: OrderSummary; plan: Plan; open: boolean; onToggle: () => void; onAnswered: (text: string) => Promise<void>; onError: (e: unknown) => void;
}) {
  const full = o.credit_used_pct >= CREDIT_FULL_PCT;
  return (
    <>
      <tr className={`clickable ${open ? "selected" : ""}`} onClick={onToggle} aria-expanded={open}>
        <td><b>{open ? "▾" : "▸"} {o.dist_city}</b><div className="cell-sub mono">{o.dist_id}</div></td>
        <td><span className={`badge ${o.proposal_version < 1 ? "" : (STATUS_TONE[o.status] ?? "")}`}>{o.proposal_version < 1 ? "Not sent" : o.replied ? o.status : "Waiting"}</span></td>
        <td className="num">{o.lines}</td>
        <td className="num">{o.cases.toLocaleString("en-IN")}</td>
        <td className="num">{inr(o.value_inr)}</td>
        <td>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className={`bar ${full ? "low" : ""}`} style={{ flex: 1 }}><span style={{ width: `${Math.min(100, o.credit_used_pct)}%` }} /></span>
            <span className="num">{o.credit_used_pct.toFixed(1)}%</span>
          </div>
          <div className="cell-sub">of {inr(o.credit_available_inr)}</div>
        </td>
        <td className="num">{o.cases_since_draft === 0 ? "–" : `${o.cases_since_draft > 0 ? "+" : ""}${o.cases_since_draft.toLocaleString("en-IN")}`}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={7} style={{ background: "var(--surface-2)", padding: "10px 14px 14px" }}>
            <Proposal order={o} plan={plan} onAnswered={onAnswered} onError={onError} />
          </td>
        </tr>
      )}
    </>
  );
}

function Proposal({ order, plan, onAnswered, onError }: { order: OrderSummary; plan: Plan; onAnswered: (text: string) => Promise<void>; onError: (e: unknown) => void }) {
  const sent = order.proposal_version >= 1;
  const msg = useLoad(() => (sent ? api.inbox(plan.plan_id, order.dist_id) : Promise.resolve(null)), [plan.plan_id, order.dist_id, plan.version, sent]);
  const [choices, setChoices] = useState<Record<string, { action: ResponseAction; qty: number }>>({});
  const [busy, setBusy] = useState(false);
  const lines = sent ? plan.lines.filter((l) => msg.data?.line_ids.includes(l.line_id)) : plan.lines.filter((l) => l.to_id === order.dist_id);

  async function send(all?: ResponseAction) {
    if (!msg.data) return;
    const actions: LineAction[] = lines.map((l) => {
      const c = all ? { action: all, qty: l.cases } : (choices[l.line_id] ?? { action: "accept" as ResponseAction, qty: l.cases });
      return { line_id: l.line_id, action: c.action, qty: c.action === "trim" ? c.qty : null };
    });
    setBusy(true);
    try {
      const res = await api.respond(plan.plan_id, { dist_id: order.dist_id, proposal_version: msg.data.proposal_version, actions });
      setChoices({});
      // line ids belong to one version: the parent re-fetches the plan
      await onAnswered(`${order.dist_city}: plan is now v${res.plan_version}. Expected cost changed by ${inr(res.delta_cost_inr)}. Proposals grown: ${res.grown_proposals.join(", ") || "none"}.`);
    } catch (e) { onError(e); } finally { setBusy(false); }
  }

  return (
    <div>
      {msg.data && <p className="bubble" style={{ marginTop: 0 }}>{msg.data.text}</p>}
      <ErrorText error={msg.error} />
      <div className="table-wrap">
        <table>
          <thead><tr><th>SKU</th><th>From</th><th className="num">Cases</th><th className="num">Life on arrival</th><th>ETA</th><th>Why</th><th>Action</th><th className="num">Quantity</th></tr></thead>
          <tbody>
            {lines.map((l) => {
              const c = choices[l.line_id] ?? { action: "accept" as ResponseAction, qty: l.cases };
              return (
                <tr key={l.line_id}>
                  <td>{l.sku_name}</td>
                  <td>{l.from_id.split("-")[1] ?? l.from_id}</td>
                  <td className="num">{l.cases.toLocaleString("en-IN")}</td>
                  <td className="num">{l.rsl_on_arrival_days} d</td>
                  <td>{l.eta}</td>
                  <td className="cell-sub" style={{ marginTop: 0 }}>{l.reasons?.[0]?.detail}</td>
                  <td>
                    <select aria-label={`Action for ${l.sku_name}`} disabled={!sent} value={c.action} onChange={(e) => setChoices({ ...choices, [l.line_id]: { ...c, action: e.target.value as ResponseAction } })}>
                      <option value="accept">Accept</option><option value="trim">Trim</option><option value="reject">Reject</option>
                    </select>
                  </td>
                  <td className="num"><input type="number" aria-label={`Trimmed quantity for ${l.sku_name}`} style={{ width: 90 }} min={0} max={l.cases} value={c.qty} disabled={!sent || c.action !== "trim"}
                    onChange={(e) => setChoices({ ...choices, [l.line_id]: { ...c, qty: Number(e.target.value) } })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sent && (
        <div className="row" style={{ marginTop: 10 }}>
          <button className="primary" disabled={busy || !lines.length} onClick={() => send()}>Send response</button>
          <button disabled={busy || !lines.length} onClick={() => send("accept")}>Accept all</button>
          <button disabled={busy || !lines.length} onClick={() => send("reject")}>Reject all</button>
        </div>
      )}
    </div>
  );
}
