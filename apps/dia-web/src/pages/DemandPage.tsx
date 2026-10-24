/** Demand analysis: the two years of history behind every forecast, how well the forecast tracks it, and what the model learned. */
import type { DemandHistory, LearnedEffects } from "@dia/types";
import { useMemo, useState } from "react";
import { api } from "../api";
import { ErrorText, Kpi, PageHeader, useLoad } from "../components/ui";

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;
const monthLabel = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = (s: string) => s.replaceAll("_", " ");

function HistoryChart({ h }: { h: DemandHistory }) {
  const W = 940, H = 340, L = 60, R = 16, T = 18, B = 38;
  const n = h.weekly.length;
  const maxY = Math.max(...h.weekly.map((p) => p.actual), ...h.backtest.map((p) => p.p90), 1) * 1.08;
  const x = (i: number) => L + (i / Math.max(n - 1, 1)) * (W - L - R);
  const y = (v: number) => H - B - (v / maxY) * (H - T - B);
  const idx = new Map(h.weekly.map((p, i) => [p.week_start, i]));
  const at = (iso: string) => idx.get(iso) ?? h.weekly.findIndex((p) => p.week_start >= iso);
  const line = h.weekly.map((p, i) => `${x(i)},${y(p.actual)}`).join(" ");
  const bt = h.backtest.filter((b) => idx.has(b.week_start)).sort((a, b) => a.week_start.localeCompare(b.week_start));
  const band = h.has_band && bt.length
    ? [...bt.map((b) => `${x(idx.get(b.week_start)!)},${y(b.p90)}`), ...[...bt].reverse().map((b) => `${x(idx.get(b.week_start)!)},${y(b.p10)}`)].join(" ")
    : "";
  const ticks = Array.from({ length: 5 }, (_, i) => (maxY / 1.08) * (i / 4));
  const monthTicks = h.weekly.map((p, i) => ({ p, i })).filter(({ p }) => /-(01|04|07|10)-(0[1-7])$/.test(p.week_start));
  const trainEnd = at("2025-09-29");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weekly demand history with backtest forecasts" style={{ width: "100%", display: "block" }}>
      {ticks.map((v) => (
        <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{Math.round(v).toLocaleString("en-IN")}</text></g>
      ))}
      {h.festivals.map((f, k) => {
        const a = at(f.start), b = at(f.end);
        if (a < 0 || b < 0) return null;
        return (
          <g key={k}><rect x={x(a) - 1} y={T} width={Math.max(x(b) - x(a), 4) + 2} height={H - T - B} fill="var(--warning-soft)" />
            <text x={x(a)} y={T + 11} fontSize="10" fill="var(--warning)">{f.name}</text></g>
        );
      })}
      {trainEnd > 0 && (
        <g><line x1={x(trainEnd)} x2={x(trainEnd)} y1={T} y2={H - B} stroke="var(--muted)" strokeDasharray="4 3" />
          <text x={x(trainEnd) + 4} y={H - B - 6} fontSize="10" fill="var(--muted)">test window</text></g>
      )}
      {band && <polygon points={band} fill="var(--primary)" opacity="0.16" />}
      <polyline points={line} fill="none" stroke="var(--text)" strokeWidth="1.6" />
      {bt.length > 0 && <polyline points={bt.map((b) => `${x(idx.get(b.week_start)!)},${y(b.p50)}`).join(" ")} fill="none" stroke="var(--primary)" strokeWidth="2" strokeDasharray="5 3" />}
      {monthTicks.map(({ p, i }) => <text key={p.week_start} x={x(i)} y={H - 14} textAnchor="middle" fontSize="11" fill="var(--muted)">{monthLabel(p.week_start)}</text>)}
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--border-strong)" />
    </svg>
  );
}

function SeasonChart({ learned, configured }: { learned: number[]; configured: number[] }) {
  const W = 420, H = 190, L = 36, R = 10, T = 12, B = 26;
  const all = [...learned, ...configured];
  const lo = Math.min(...all) - 0.03, hi = Math.max(...all) + 0.03;
  const x = (i: number) => L + (i / 11) * (W - L - R), y = (v: number) => H - B - ((v - lo) / (hi - lo)) * (H - T - B);
  const path = (a: number[]) => a.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly seasonal index, learned and configured" style={{ width: "100%", display: "block" }}>
      {[lo + 0.03, 1, hi - 0.03].map((v, k) => <g key={k}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--border)" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">{v.toFixed(2)}</text></g>)}
      <polyline points={path(configured)} fill="none" stroke="var(--muted)" strokeWidth="2" strokeDasharray="4 3" />
      <polyline points={path(learned)} fill="none" stroke="var(--primary)" strokeWidth="2.2" />
      {MONTHS.map((m, i) => <text key={m} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">{m}</text>)}
    </svg>
  );
}

function Learned({ e }: { e: LearnedEffects }) {
  const cats = Object.keys(e.seasonality);
  const [cat, setCat] = useState("beverages");
  const c = cats.includes(cat) ? cat : cats[0]!;
  const rows = useMemo(() => e.festivals.flatMap((f) => Object.entries(f.learned).map(([category, learned]) => ({ name: f.name, category, learned, configured: f.configured[category] }))), [e]);
  const gap = rows.filter((r) => r.configured != null).map((r) => Math.abs(r.learned - r.configured!));
  const meanGap = gap.length ? gap.reduce((s, v) => s + v, 0) / gap.length : 0;
  return (
    <>
      <h2>What the forecaster learned</h2>
      <p className="muted" style={{ marginBottom: 12 }}>Fitted on the history before the test window and used in every plan. The configured values are what the simulator was built with, so this is a recovery check.</p>
      <div className="card">
        <div className="card-h"><h3>Festival uplift</h3><span className="badge info">mean gap to configured {meanGap.toFixed(2)}</span></div>
        <div className="table-wrap scroll" style={{ maxHeight: 340, boxShadow: "none" }}>
          <table>
            <thead><tr><th>Festival</th><th>Category</th><th className="num">Learned</th><th className="num">Configured</th><th style={{ width: 220 }}>Learned uplift</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name + r.category}>
                  <td>{r.name}</td><td>{nice(r.category)}</td><td className="num">×{r.learned.toFixed(2)}</td>
                  <td className="num muted">{r.configured != null ? `×${r.configured.toFixed(2)}` : "–"}</td>
                  <td><span className="bar"><span style={{ width: `${Math.min(100, ((r.learned - 1) / 0.6) * 100)}%` }} /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="kpis" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
        <div className="card">
          <div className="card-h"><h3>Seasonality by month</h3>
            <select aria-label="Category" value={c} onChange={(ev) => setCat(ev.target.value)} style={{ height: 30 }}>{cats.map((k) => <option key={k} value={k}>{nice(k)}</option>)}</select></div>
          <SeasonChart learned={e.seasonality[c] ?? []} configured={e.seasonality_configured[c] ?? []} />
          <div className="legend"><span><i style={{ background: "var(--primary)" }} />learned</span><span><i style={{ background: "var(--muted)" }} />configured</span></div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Weather sensitivity</h3></div>
          <div className="table-wrap" style={{ boxShadow: "none" }}>
            <table>
              <thead><tr><th>Category</th><th className="num">Heat, % per °C above 32</th><th className="num">Rain cut, % on heavy-rain days</th></tr></thead>
              <tbody>
                {e.weather.map((w) => (
                  <tr key={w.category}><td>{nice(w.category)}</td>
                    <td className="num">{w.heat_pct_per_degc_learned.toFixed(1)}<span className="muted"> / {w.heat_pct_per_degc_configured.toFixed(1)}</span></td>
                    <td className="num">{w.rain_cut_pct_learned.toFixed(0)}<span className="muted"> / {w.rain_cut_pct_configured.toFixed(0)}</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note" style={{ marginTop: 8 }}>Learned / configured. Heat is the effect left after the monthly curve, which absorbs most of it.</p>
        </div>
      </div>
      <div className="callout">
        <h3>How to read this honestly</h3>
        <p>Festival uplifts are recovered closely. The monthly seasonal curve and the heat effect are recovered only weakly: the model tracks the season through its weekly level instead, which is why accuracy stays good. The accuracy figures above are the real test.</p>
        <p>The simulator and the model share structure, so the error figures flatter the model. A pilot on real exports is the proper check.</p>
      </div>
    </>
  );
}

export function DemandPage() {
  const scenarios = useLoad(api.scenarios, []);
  const sid = scenarios.data?.[0] ?? "";
  const scenario = useLoad(() => (sid ? api.scenario(sid) : Promise.resolve(null)), [sid]);
  const [dist, setDist] = useState("");
  const [sku, setSku] = useState("");
  const hist = useLoad(() => (sid ? api.history(sid, dist || undefined, sku || undefined) : Promise.resolve(null)), [sid, dist, sku]);
  const effects = useLoad(() => (sid ? api.effects(sid) : Promise.resolve(null)), [sid]);
  const metrics = useLoad(() => (sid ? api.backtest(sid) : Promise.resolve(null)), [sid]);
  const m = metrics.data;
  const dists = (scenario.data?.nodes ?? []).filter((n) => n.type === "distributor");
  const skus = scenario.data?.skus ?? [];
  const h = hist.data;

  return (
    <section>
      <PageHeader title="Demand analysis" sub="Two years of daily history, 25 Sep 2023 to 28 Sep 2025, sit behind every forecast. See the demand, how closely the forecast followed it in 12 backtests, and what the model learned about festivals and weather." />
      <div className="card toolbar">
        <label>Distributor
          <select value={dist} onChange={(e) => setDist(e.target.value)}>
            <option value="">All distributors</option>
            {dists.map((n) => <option key={n.node_id} value={n.node_id}>{n.city}</option>)}
          </select>
        </label>
        <label>SKU
          <select value={sku} onChange={(e) => setSku(e.target.value)}>
            <option value="">All SKUs</option>
            {skus.map((s) => <option key={s.sku_id} value={s.sku_id}>{s.name}</option>)}
          </select>
        </label>
        <span className="muted" style={{ alignSelf: "center" }}>{h ? `${h.label} · cases per week` : "Loading…"}</span>
      </div>
      <ErrorText error={hist.error ?? effects.error ?? metrics.error ?? scenarios.error} />

      {m && (
        <div className="kpis">
          <Kpi label="Forecast error (WAPE)" value={pct(m.wape)} hint={`Seasonal naive: ${pct(m.wape_seasonal_naive)}`} tone="good" />
          <Kpi label="Improvement over naive" value={pct(1 - m.wape / m.wape_seasonal_naive, 0)} hint="Lower error than last year's same week" tone="good" />
          <Kpi label="Bias" value={`${m.bias > 0 ? "+" : ""}${pct(m.bias)}`} hint="Over (+) or under (−) forecast, overall" />
          <Kpi label="Band coverage" value={pct(m.coverage_p10_p90, 0)} hint="Share of weeks inside P10–P90 (aim 80%)" />
          <Kpi label="Festival-week error" value={pct(m.wape_festival_weeks)} hint="WAPE in festival weeks only" />
        </div>
      )}

      {h && (
        <div className="card">
          <div className="card-h"><h3>Weekly demand and backtest forecast</h3>
            <div className="legend" style={{ margin: 0 }}>
              <span><i style={{ background: "var(--text)" }} />actual</span>
              <span><i style={{ background: "var(--primary)" }} />forecast, 1 to 4 weeks ahead</span>
              {h.has_band && <span><i style={{ background: "var(--primary)", opacity: 0.3 }} />P10 to P90</span>}
              <span><i style={{ background: "var(--warning-soft)", border: "1px solid var(--warning)" }} />festival run-up</span>
            </div>
          </div>
          <HistoryChart h={h} />
          {!h.has_band && <p className="note">Pick one distributor and one SKU to see the P10–P90 band; sums of bands are not bands.</p>}
        </div>
      )}
      {effects.data && <Learned e={effects.data} />}
    </section>
  );
}
