/**
 * Vitaran Warehouse: phone-first app for depot and distributor staff.
 * Space (how full each store and godown is, what still fits), Stock (lots, oldest expiry first), Alerts (stock that
 * may expire), Trucks (to load, or coming in) and Record (receipt, count, adjustment). Every number comes from the
 * engine through /v1/wh; counts recorded here are applied before space is shown and before the next plan is made.
 */
import type { AtRisk, DispatchResponse, Movement, MovementRequest, Scenario, SpaceNode, SpaceReport, WhStock, WhUser } from "@dia/types";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError, savedToken, saveToken } from "./api";

type Tab = "space" | "stock" | "alerts" | "trucks" | "record";
type Ctx = { token: string; user: WhUser; scenario: Scenario; asOf: string; city: (id: string) => string; onAuthError: (e: unknown) => void };

const fmt = (n: number, d = 0) => n.toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function useLoad<T>(fn: () => Promise<T>, deps: unknown[], onError: (e: unknown) => void) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fn().then((data) => live && setState({ data, loading: false }), (e) => { if (live) { setState({ error: errText(e), loading: false }); onError(e); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

// ------------------------------------------------------------------------------------------- icons

const I = {
  space: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-6 9 6v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M7 21v-8h10v8M7 16h10" /></svg>,
  stock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8M12 13v8" /></svg>,
  alerts: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2 2M9 2h6" /></svg>,
  trucks: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 6h13v10H1zM14 10h4l3 3v3h-7z" /><circle cx="5.5" cy="18.5" r="2" /><circle cx="17.5" cy="18.5" r="2" /></svg>,
  record: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z" /><path d="M16 5h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2M9 13l2 2 4-4" /></svg>,
};

// ------------------------------------------------------------------------------------------- app

export function App() {
  const [token, setToken] = useState<string | null>(savedToken());
  const [user, setUser] = useState<WhUser | null>(null);
  const [world, setWorld] = useState<{ scenario: Scenario; asOf: string } | null>(null);
  const [tab, setTab] = useState<Tab>("space");
  const [alertCount, setAlertCount] = useState(0);

  const logout = useCallback(() => { saveToken(null); setToken(null); setUser(null); setWorld(null); }, []);
  const onAuthError = useCallback((e: unknown) => { if (e instanceof ApiError && e.status === 401) logout(); }, [logout]);

  useEffect(() => {
    if (!token) return;
    let live = true;
    (async () => {
      try {
        const [me, day] = await Promise.all([api.me(token), api.day(token)]);
        const scenario = await api.scenario(day.scenario_id);
        if (live) { setUser(me); setWorld({ scenario, asOf: day.as_of }); }
        const alerts = await api.alerts(token);
        if (live) setAlertCount(alerts.length);
      } catch (e) { if (live) onAuthError(e); }
    })();
    return () => { live = false; };
  }, [token, onAuthError]);

  if (!token) return <Login onIn={(t) => { saveToken(t); setToken(t); }} />;
  if (!user || !world) return <div className="login"><p className="empty">Loading…</p></div>;

  const nodes = new Map(world.scenario.nodes.map((n) => [n.node_id, n]));
  const ctx: Ctx = { token, user, scenario: world.scenario, asOf: world.asOf, city: (id) => nodes.get(id)?.city ?? id, onAuthError };
  const roleLabel = user.role === "planner" ? "All warehouses" : user.role === "depot" ? "Depot" : "Distributor";

  return (
    <div className="shell">
      <header className="bar">
        <img src="/icon.svg" alt="" width={30} height={30} />
        <div className="who"><b>{user.name}</b><span>{roleLabel} · {fmtDay(world.asOf)}</span></div>
        <button onClick={logout}>Log out</button>
      </header>
      <main className="content">
        {tab === "space" && <SpaceScreen ctx={ctx} />}
        {tab === "stock" && <StockScreen ctx={ctx} />}
        {tab === "alerts" && <AlertsScreen ctx={ctx} />}
        {tab === "trucks" && <TrucksScreen ctx={ctx} />}
        {tab === "record" && <RecordScreen ctx={ctx} />}
      </main>
      <div className="tabs">
        <nav aria-label="Sections">
          {([["space", "Space"], ["stock", "Stock"], ["alerts", "Alerts"], ["trucks", "Trucks"], ["record", "Record"]] as Array<[Tab, string]>).map(([id, label]) => (
            <button key={id} className={tab === id ? "on" : ""} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
              {I[id]}{label}{id === "alerts" && alertCount > 0 && <span className="count">{alertCount}</span>}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------- login

function Login({ onIn }: { onIn: (token: string) => void }) {
  const [users, setUsers] = useState<WhUser[]>([]);
  const [userId, setUserId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.users().then((u) => { setUsers(u); setUserId((x) => x || u[1]?.user_id || ""); }, (e) => setError(errText(e))); }, []);
  const groups: Array<[string, WhUser[]]> = [
    ["Depots", users.filter((u) => u.role === "depot")],
    ["Distributors", users.filter((u) => u.role === "distributor")],
    ["Planning", users.filter((u) => u.role === "planner")],
  ];
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try { onIn((await api.login(userId, pin)).token); } catch (err) { setError(err instanceof ApiError && err.status === 401 ? "Wrong PIN for this user." : errText(err)); } finally { setBusy(false); }
  }
  return (
    <form className="login" onSubmit={submit}>
      <div className="brand">
        <img src="/icon.svg" alt="" />
        <div><h1>Vitaran Warehouse</h1><p>Space, stock, expiry and trucks</p></div>
      </div>
      <label>Who are you?
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          {groups.map(([g, us]) => us.length > 0 && <optgroup key={g} label={g}>{us.map((u) => <option key={u.user_id} value={u.user_id}>{u.name}</option>)}</optgroup>)}
        </select>
      </label>
      <label>PIN
        <input type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} />
      </label>
      {error && <p className="notice bad" role="alert">{error}</p>}
      <button className="btn primary" disabled={busy || !userId || !pin}>{busy ? "Signing in…" : "Sign in"}</button>
      <p className="muted" style={{ fontSize: 13 }}>Demo users and PIN: docs/Warehouse-app.md</p>
    </form>
  );
}

// ------------------------------------------------------------------------------------------- space

function level(pct: number) { return pct >= 90 ? "high" : pct >= 70 ? "mid" : ""; }
function pillFor(pct: number) { return pct >= 90 ? "bad" : pct >= 70 ? "warn" : "ok"; }

function SpaceCard({ n, ctx }: { n: SpaceNode; ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const label = n.node_type === "depot" ? `${n.city} · ${n.temp_class === "chilled" ? "cold room" : "ambient store"}` : `${n.city} godown`;
  const fits = [...n.fits].sort((a, b) => a.cases - b.cases);
  return (
    <div className="card tap" onClick={() => setOpen(!open)} role="button" aria-expanded={open}>
      <div className="row">
        <div className="grow"><b>{label}</b><div className="muted" style={{ fontSize: 13 }}>{fmt(n.cases)} cases on hand</div></div>
        <span className={`pill ${pillFor(n.used_pct)}`}>{fmt(n.used_pct)}% full</span>
      </div>
      <div className={`meter ${level(n.used_pct)}`}><i style={{ width: `${Math.min(100, n.used_pct)}%` }} /></div>
      <div className="row muted num" style={{ fontSize: 13 }}>
        <span className="grow"><b style={{ color: "var(--text)" }}>{fmt(n.free_m3, 1)} m³ free</b> of {fmt(n.capacity_m3, 1)} m³</span>
        <span>{open ? "Hide" : "What fits?"}</span>
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          <p className="muted" style={{ fontSize: 13, marginBottom: 6 }}>Free space holds about this many more cases of one product:</p>
          {fits.map((f) => (
            <div key={f.sku_id} className="row num" style={{ fontSize: 14, padding: "4px 0", borderTop: "1px solid var(--border)" }}>
              <span className="grow">{f.sku_name}</span><b>{fmt(f.cases)}</b>
            </div>
          ))}
          {ctx.user.role !== "distributor" && n.node_type === "distributor" && n.free_m3 < 5 &&
            <p className="notice bad" style={{ marginTop: 8 }}>Nearly full: check before loading more for {n.city}.</p>}
        </div>
      )}
    </div>
  );
}

function SpaceScreen({ ctx }: { ctx: Ctx }) {
  const s = useLoad<SpaceReport>(() => api.space(ctx.token), [ctx.token], ctx.onAuthError);
  if (s.loading && !s.data) return <p className="empty">Loading space…</p>;
  if (s.error) return <p className="notice bad">{s.error}</p>;
  const rep = s.data!;
  const own = ctx.user.role === "depot" ? "My stores" : ctx.user.role === "distributor" ? "My godown" : "Depots";
  return (
    <>
      <div className="title"><h2>Space</h2><span className="muted" style={{ fontSize: 13 }}>tap a card for what fits</span></div>
      {rep.depots.length > 0 && <p className="section">{own}</p>}
      {rep.depots.map((n) => <SpaceCard key={`${n.node_id}-${n.temp_class}`} n={n} ctx={ctx} />)}
      {rep.distributors.length > 0 && <p className="section">{ctx.user.role === "distributor" ? own : "Distributor godowns"}</p>}
      {rep.distributors.map((n) => <SpaceCard key={n.node_id} n={n} ctx={ctx} />)}
      <p className="muted" style={{ fontSize: 12 }}>Morning of {fmtDay(rep.as_of)}, after plant receipts, before dispatch. Counted stock is included.</p>
    </>
  );
}

// ------------------------------------------------------------------------------------------- stock

function NodePicker({ ctx, value, onChange }: { ctx: Ctx; value: string; onChange: (v: string) => void }) {
  const nodes = ctx.scenario.nodes.filter((n) => ctx.user.role === "planner" || n.node_id === ctx.user.node_id || n.home_depot_id === ctx.user.node_id);
  if (nodes.length <= 1) return null;
  return (
    <label>Warehouse
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {nodes.map((n) => <option key={n.node_id} value={n.node_id}>{n.city} {n.type === "depot" ? "depot" : "distributor"}</option>)}
      </select>
    </label>
  );
}

function StockScreen({ ctx }: { ctx: Ctx }) {
  const first = ctx.user.node_id ?? ctx.scenario.nodes.find((n) => n.type === "depot")!.node_id;
  const [node, setNode] = useState(first);
  const [q, setQ] = useState("");
  const s = useLoad<WhStock>(() => api.stock(ctx.token, node), [ctx.token, node], ctx.onAuthError);
  const rows = (s.data?.rows ?? []).filter((r) => !q || r.sku_name.toLowerCase().includes(q.toLowerCase()));
  const total = rows.reduce((a, r) => a + r.cases, 0);
  return (
    <>
      <div className="title"><h2>Stock</h2><span className="muted num" style={{ fontSize: 13 }}>{fmt(total)} cases</span></div>
      <NodePicker ctx={ctx} value={node} onChange={setNode} />
      <input placeholder="Search a product" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search a product" />
      {s.error && <p className="notice bad">{s.error}</p>}
      {s.loading && !s.data ? <p className="empty">Loading stock…</p> : rows.length === 0 ? <p className="empty">No stock here.</p> : (
        <div className="list">
          {rows.map((r, i) => (
            <div className="item" key={`${r.lot_id ?? r.sku_id}-${r.state}-${i}`}>
              <div className="main">
                <b>{r.sku_name}</b>
                <span className="sub">{r.lot_id ?? "counted on shelf"} · {r.temp_class}{r.state === "in_transit" ? " · on the way" : ""}</span>
              </div>
              <div className="side num">
                <b>{fmt(r.cases)}</b> <span className="muted" style={{ fontSize: 12 }}>cases</span>
                <div>{r.days_left === null ? <span className="pill info">counted</span>
                  : <span className={`pill ${r.days_left <= 7 ? "bad" : r.days_left <= 30 ? "warn" : "ok"}`}>{r.days_left} days left</span>}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------- alerts

function AlertsScreen({ ctx }: { ctx: Ctx }) {
  const s = useLoad<AtRisk[]>(() => api.alerts(ctx.token), [ctx.token], ctx.onAuthError);
  const rows = s.data ?? [];
  return (
    <>
      <div className="title"><h2>Expiry alerts</h2><span className="muted" style={{ fontSize: 13 }}>{rows.length} lots</span></div>
      <p className="muted" style={{ fontSize: 13 }}>Stock likely to expire before it sells at today’s pace, most urgent first.</p>
      {s.error && <p className="notice bad">{s.error}</p>}
      {s.loading && !s.data ? <p className="empty">Loading…</p> : rows.length === 0 ? <p className="empty">Nothing at risk. Good.</p> : (
        <div className="list">
          {rows.map((r, i) => (
            <div className="item" key={`${r.lot_id}-${i}`}>
              <div className="main">
                <b>{r.sku_name}</b>
                <span className="sub">{r.dist_city} {r.holder_type} · {r.lot_id ?? ""}</span>
                <div style={{ fontSize: 14, marginTop: 4 }}>{r.suggested_action}</div>
              </div>
              <div className="side num">
                <b>{fmt(r.stock_cases)}</b> <span className="muted" style={{ fontSize: 12 }}>cases</span>
                <div><span className={`pill ${r.days_left <= 7 ? "bad" : "warn"}`}>{r.days_left} days left</span></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------------------------------- trucks

function TrucksScreen({ ctx }: { ctx: Ctx }) {
  const s = useLoad<DispatchResponse[]>(() => api.loading(ctx.token), [ctx.token], ctx.onAuthError);
  const trucks = (s.data ?? []).flatMap((d) => d.trucks);
  const incoming = ctx.user.role === "distributor";
  return (
    <>
      <div className="title"><h2>{incoming ? "Coming to you" : "Trucks to load"}</h2><span className="muted" style={{ fontSize: 13 }}>{trucks.length} trucks</span></div>
      {s.error && <p className="notice bad">{s.error}</p>}
      {s.loading && !s.data ? <p className="empty">Loading…</p> : trucks.length === 0
        ? <p className="empty">No plan sent for {fmtDay(ctx.asOf)} yet. Trucks appear once the planner sends today’s plan to distributors.</p>
        : trucks.map(({ truck: t, lines }) => (
          <div className="card" key={t.truck_id}>
            <div className="row">
              <div className="grow"><b>{incoming ? `From ${ctx.city(t.from_id)}` : `To ${ctx.city(t.to_id)}`}</b>
                <div className="muted" style={{ fontSize: 13 }}>{t.truck_id} · {t.mode === "FTL" ? "full truck" : "part load"} · {t.ship_date}</div></div>
              <span className={`pill ${Math.max(t.kg_pct, t.m3_pct) >= 85 ? "ok" : "warn"}`}>{fmt(Math.max(t.kg_pct, t.m3_pct))}% full</span>
            </div>
            <div style={{ marginTop: 8 }}>
              {lines.map((l) => (
                <div key={l.line_id} className="row num" style={{ fontSize: 14, padding: "6px 0", borderTop: "1px solid var(--border)" }}>
                  <span className="grow">{l.sku_name}<span className="muted" style={{ fontSize: 12 }}> · {l.lot_id} · exp {l.expiry}</span></span>
                  <b>{fmt(l.cases)}</b>
                </div>
              ))}
            </div>
            {!incoming && <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>Load top to bottom: oldest expiry first.</p>}
          </div>
        ))}
    </>
  );
}

// ------------------------------------------------------------------------------------------- record

const KINDS: Array<[MovementRequest["kind"], string, string]> = [
  ["count", "Count", "Cases you counted on the shelf. Replaces the system figure for today."],
  ["receipt", "Receipt", "Cases that arrived on a truck."],
  ["adjust", "Adjust", "Damage or shortage: a negative number takes stock off, e.g. -6."],
];

function RecordScreen({ ctx }: { ctx: Ctx }) {
  const [node, setNode] = useState(ctx.user.node_id ?? ctx.scenario.nodes.find((n) => n.type === "depot")!.node_id);
  const [kind, setKind] = useState<MovementRequest["kind"]>("count");
  const nodeType = ctx.scenario.nodes.find((n) => n.node_id === node)?.type;
  const skus = useMemo(() => ctx.scenario.skus.slice().sort((a, b) => a.name.localeCompare(b.name)), [ctx.scenario]);
  const [sku, setSku] = useState(skus[0]?.sku_id ?? "");
  const [cases, setCases] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const moves = useLoad<Movement[]>(() => api.movements(ctx.token), [ctx.token], ctx.onAuthError);
  const canChange = ctx.user.role === "planner" || node === ctx.user.node_id;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const m = await api.record(ctx.token, { kind, node_id: node, sku_id: sku, cases: Number(cases), reason: reason.trim() || null });
      setMsg({ ok: true, text: `Saved: ${m.kind} of ${fmt(m.cases)} cases of ${m.sku_name}. ${kind === "receipt" ? "" : "Space and the next plan use it."}` });
      setCases(""); setReason(""); moves.reload();
    } catch (err) { setMsg({ ok: false, text: errText(err) }); } finally { setBusy(false); }
  }
  return (
    <>
      <div className="title"><h2>Record</h2></div>
      <NodePicker ctx={ctx} value={node} onChange={setNode} />
      <form className="form card" onSubmit={submit}>
        <div className="seg" role="group" aria-label="What happened">
          {KINDS.map(([k, label]) => <button type="button" key={k} className={kind === k ? "on" : ""} aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>)}
        </div>
        <p className="muted" style={{ fontSize: 13 }}>{KINDS.find((k) => k[0] === kind)![2]}</p>
        <label>Product
          <select value={sku} onChange={(e) => setSku(e.target.value)}>
            {skus.map((s) => <option key={s.sku_id} value={s.sku_id}>{s.name}{nodeType === "depot" ? ` · ${s.temp_class}` : ""}</option>)}
          </select>
        </label>
        <label>Cases
          <input type="number" inputMode="decimal" step="1" value={cases} onChange={(e) => setCases(e.target.value)} placeholder={kind === "adjust" ? "-6" : "120"} />
        </label>
        {kind !== "count" && <label>Note (optional)<input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder={kind === "adjust" ? "damaged in unloading" : "truck T-E1-D13-01"} /></label>}
        {!canChange && <p className="notice bad">You can only record stock at your own warehouse.</p>}
        {msg && <p className={`notice ${msg.ok ? "ok" : "bad"}`} role="status">{msg.text}</p>}
        <button className="btn primary" disabled={busy || !canChange || cases === "" || Number.isNaN(Number(cases))}>{busy ? "Saving…" : "Save"}</button>
      </form>
      <p className="section">Today</p>
      {(moves.data ?? []).length === 0 ? <p className="empty">Nothing recorded today.</p> : (
        <div className="list">
          {moves.data!.map((m) => (
            <div className="item" key={m.movement_id}>
              <div className="main"><b>{m.sku_name}</b><span className="sub">{ctx.city(m.node_id)} · {m.user_id}{m.reason ? ` · ${m.reason}` : ""}</span></div>
              <div className="side num"><span className="pill info">{m.kind}</span><div><b>{m.kind === "adjust" && m.cases > 0 ? "+" : ""}{fmt(m.cases)}</b></div></div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

