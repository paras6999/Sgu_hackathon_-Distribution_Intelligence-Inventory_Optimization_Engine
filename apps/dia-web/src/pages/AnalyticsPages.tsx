/**
 * Evaluation pages: Results (FR-11), Frontier & Ablation (FR-11, FR-12), Assumptions (FR-15), and the Map placeholder.
 * All numbers come from the cached experiment (`GET /v1/experiments/{id}/results`); nothing is computed here
 * beyond relative differences and the target check of PRD 8.2.
 */
import type { AblationRow, AssumptionRow, ExperimentResults, FrontierPoint, KpiSummary, OpeningState, Plan } from "@dia/types";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { AnalysisPanel } from "../components/AnalysisPanel";
import { ErrorText, ReasonChips, useLoad } from "../components/ui";

/** MapLibre is large; it loads only when the Map tab is opened. */
const NetworkMap = lazy(() => import("../components/NetworkMap").then((m) => ({ default: m.NetworkMap })));

// ---------------------------------------------------------------------------------------------- shared

type Fmt = "pct" | "inr" | "inr_case" | "kg";
interface KpiMeta { label: string; fmt: Fmt; higherBetter: boolean }

const KPI_META: Record<string, KpiMeta> = {
  fill_rate: { label: "Fill rate", fmt: "pct", higherBetter: true },
  festival_fill_rate: { label: "Festival-week fill rate", fmt: "pct", higherBetter: true },
  stockout_rate: { label: "Stockout rate", fmt: "pct", higherBetter: false },
  lost_margin_inr: { label: "Lost margin", fmt: "inr", higherBetter: false },
  wastage_inr: { label: "Wastage", fmt: "inr", higherBetter: false },
  freight_inr_per_case: { label: "Freight per case", fmt: "inr_case", higherBetter: false },
  ftl_utilisation: { label: "FTL utilisation", fmt: "pct", higherBetter: true },
  cost_to_serve_inr: { label: "Total cost to serve", fmt: "inr", higherBetter: false },
  cover_extremes: { label: "Cover extremes", fmt: "pct", higherBetter: false },
  co2_kg_per_case: { label: "CO₂ per case", fmt: "kg", higherBetter: false },
};
const KPI_ORDER = Object.keys(KPI_META);
const metaOf = (kpi: string): KpiMeta => KPI_META[kpi] ?? { label: kpi, fmt: "inr", higherBetter: false };
const HEADLINE = ["cost_to_serve_inr", "fill_rate", "wastage_inr", "freight_inr_per_case"];
const POLICY_LABEL: Record<string, string> = { engine: "Engine", baseline_a: "Baseline A", baseline_b: "Baseline B" };
const POLICY_COLOUR: Record<string, string> = { engine: "var(--primary)", baseline_a: "var(--neutral)", baseline_b: "var(--baseline-b)" };
const STATES: OpeningState[] = ["neutral", "imbalanced"];

function inr(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(1)} lakh`;
  return `${sign}₹${a.toFixed(0)}`;
}
function fmt(v: number, f: Fmt): string {
  if (!Number.isFinite(v)) return "–";
  if (f === "pct") return `${(v * 100).toFixed(1)}%`;
  if (f === "inr") return inr(v);
  if (f === "inr_case") return `₹${v.toFixed(0)}`;
  return `${v.toFixed(2)} kg`;
}
/** Signed difference in the unit of the KPI (percentage points for rates). */
function fmtDelta(v: number, f: Fmt): string {
  const s = v > 0 ? "+" : v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (f === "pct") return `${s}${(a * 100).toFixed(1)} pp`;
  if (f === "inr") return `${s}${inr(a).replace("−", "")}`;
  if (f === "inr_case") return `${s}₹${a.toFixed(0)}`;
  return `${s}${a.toFixed(2)} kg`;
}

/** "[low, high]" of the paired interval, always in ascending order. */
function ci(k: KpiSummary, f: Fmt): string {
  const lo = Math.min(k.delta_ci_low ?? 0, k.delta_ci_high ?? 0), hi = Math.max(k.delta_ci_low ?? 0, k.delta_ci_high ?? 0);
  return `[${fmtDelta(lo, f)}, ${fmtDelta(hi, f)}]`;
}

/** Load the cached headline experiment (same request as the demo: the backend returns the cached run). */
function useExperiment() {
  const [id, setId] = useState<string | null>(null);
  const [startError, setStartError] = useState<unknown>(null);
  const start = () => { setStartError(null); api.startExperiment().then((r) => setId(r.experiment_id), setStartError); };
  useEffect(start, []);
  const [tick, setTick] = useState(0);
  const info = useLoad(() => (id ? api.experiment(id) : Promise.resolve(null)), [id, tick]);
  const running = info.data?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [running]);
  const results = useLoad(() => (id && info.data?.status === "done" ? api.results(id) : Promise.resolve(null)), [id, info.data?.status]);
  return { id, info: info.data, results: results.data as ExperimentResults | null | undefined, error: startError ?? info.error ?? results.error, restart: start };
}

function StatusLine({ ex }: { ex: ReturnType<typeof useExperiment> }) {
  const { info } = ex;
  if (!ex.id) return <p>Connecting…</p>;
  if (info?.status === "running") return <p>Experiment {ex.id} is running: {info.progress_pct.toFixed(0)}% of seeds finished. This page refreshes itself.</p>;
  if (info?.status === "failed") return <p className="error">Experiment {ex.id} failed: {info.error}</p>;
  return null;
}

function Toggle({ value, onChange }: { value: OpeningState; onChange: (v: OpeningState) => void }) {
  return (
    <div className="row" role="group" aria-label="Opening state">
      {STATES.map((s) => (
        <button key={s} className={value === s ? "primary" : "secondary"} onClick={() => onChange(s)}>
          {s === "neutral" ? "Neutral start" : "Imbalanced start"}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Results

/** PRD 8.2 targets: a target is met when the mean difference reaches it and the 90% CI excludes zero in the favourable direction. */
interface Target { text: string; met: (k: KpiSummary, best: number) => boolean }
function targetFor(kpi: string, state: OpeningState): Target | null {
  const imb = state === "imbalanced";
  const rel = (cut: number) => (k: KpiSummary, best: number) => !!k.delta_vs_best_baseline && k.delta_vs_best_baseline / best <= -cut && (k.delta_ci_high ?? 1) < 0;
  switch (kpi) {
    case "fill_rate": { const pp = imb ? 0.04 : 0.02; return { text: `≥ +${pp * 100} pp`, met: (k) => !!k.delta_vs_best_baseline && k.delta_vs_best_baseline >= pp && (k.delta_ci_low ?? -1) > 0 }; }
    case "stockout_rate": { const c = imb ? 0.3 : 0.2; return { text: `≤ −${c * 100}%`, met: rel(c) }; }
    case "lost_margin_inr": { const c = imb ? 0.3 : 0.2; return { text: `≤ −${c * 100}%`, met: rel(c) }; }
    case "wastage_inr": { const c = imb ? 0.35 : 0.2; return { text: `≤ −${c * 100}%`, met: rel(c) }; }
    case "freight_inr_per_case": return { text: "≤ +5%", met: (k, best) => !!k.delta_vs_best_baseline && k.delta_vs_best_baseline / best <= 0.05 };
    case "ftl_utilisation": return { text: "≥ 85%", met: (k) => k.mean >= 0.85 };
    case "cost_to_serve_inr": { const c = imb ? 0.15 : 0.08; return { text: `≤ −${c * 100}%`, met: rel(c) }; }
    case "cover_extremes": { const c = imb ? 0.4 : 0.25; return { text: `≤ −${c * 100}%`, met: rel(c) }; }
    case "co2_kg_per_case": return { text: "≤ baseline", met: (k) => !!k.delta_vs_best_baseline && k.delta_vs_best_baseline <= 0 };
    default: return null;
  }
}

const WORSENS_CAUSE: Record<string, string> = {
  fill_rate: "The engine ships a case only when the expected lost margin beats freight, holding and expiry cost. On thin, low-margin lanes it accepts a few more stockouts instead of sending part-empty trucks.",
  festival_fill_rate: "Same trade-off, sharper in the festival run-up, when forecast error is larger and extra stock is dearer to carry.",
  stockout_rate: "Fewer, fuller trucks mean slimmer safety stock on slow SKUs.",
  lost_margin_inr: "The margin given up on the extra stockouts; it is far smaller than the freight and wastage saved.",
  cover_extremes: "Tighter cover also means more days with a SKU at zero stock.",
};

export function ResultsPage() {
  const ex = useExperiment();
  const [state, setState] = useState<OpeningState>("imbalanced");
  const rows = ex.results?.kpis.filter((k) => k.opening_state === state) ?? [];
  const get = (kpi: string, policy: string) => rows.find((k) => k.kpi === kpi && k.policy === policy);
  const bestBaseline = (kpi: string): number | null => {
    const e = get(kpi, "engine");
    if (!e || e.delta_vs_best_baseline == null) return null;
    return e.mean - e.delta_vs_best_baseline;
  };
  const worse = useMemo(() => KPI_ORDER.map((kpi) => {
    const e = rows.find((k) => k.kpi === kpi && k.policy === "engine");
    if (!e || e.delta_vs_best_baseline == null) return null;
    const bad = metaOf(kpi).higherBetter ? (e.delta_ci_high ?? 0) < 0 : (e.delta_ci_low ?? 0) > 0;
    return bad ? { kpi, e } : null;
  }).filter((x): x is { kpi: string; e: KpiSummary } => x !== null), [rows]);

  const engineSeeds = get("cost_to_serve_inr", "engine")?.n_seeds;
  return (
    <div>
      <h2>Results</h2>
      <p style={{ color: "var(--neutral)" }}>
        The engine against the <b>better</b> of Baseline A and Baseline B on each KPI. Means with 90% intervals over{" "}
        {engineSeeds ?? "…"} seeds; differences are paired by seed (identical demand, delays and promotions for every policy).
      </p>
      <div className="row"><Toggle value={state} onChange={setState} /><button className="secondary" onClick={ex.restart}>Reload</button></div>
      <ErrorText error={ex.error} />
      <StatusLine ex={ex} />
      {ex.results === null && ex.info?.status === "done" && <p>No results yet.</p>}
      {ex.results && rows.length === 0 && <p>No rows for this opening state.</p>}

      {rows.length > 0 && (
        <>
          <AnalysisPanel title="Deep analysis of these results" request={ex.id ? { kind: "results", experiment_id: ex.id, opening_state: state } : null} />
          <div className="kpis">
            {HEADLINE.map((kpi) => {
              const e = get(kpi, "engine"); const m = metaOf(kpi);
              if (!e) return null;
              const best = bestBaseline(kpi);
              const d = e.delta_vs_best_baseline;
              const good = d == null ? null : m.higherBetter ? d > 0 : d < 0;
              return (
                <div className="card kpi" key={kpi}>
                  <div className="label">{m.label} · Engine</div>
                  <div className="value">{fmt(e.mean, m.fmt)}</div>
                  {d != null && best ? (
                    <div style={{ color: good ? "var(--success)" : "var(--danger)", fontSize: 13 }}>
                      {fmtDelta(d, m.fmt)}{m.fmt === "pct" ? "" : ` (${d > 0 ? "+" : "−"}${Math.abs((d / best) * 100).toFixed(0)}%)`} vs better baseline
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="table-wrap card">
            <table>
              <thead>
                <tr>
                  <th>KPI</th><th>Baseline A</th><th>Baseline B</th><th>Engine</th>
                  <th>Engine − better baseline (90% CI)</th><th>Target (PRD 8.2)</th><th>Met</th>
                </tr>
              </thead>
              <tbody>
                {KPI_ORDER.map((kpi) => {
                  const m = metaOf(kpi); const e = get(kpi, "engine");
                  if (!e) return null;
                  const best = bestBaseline(kpi);
                  const t = targetFor(kpi, state);
                  const d = e.delta_vs_best_baseline;
                  const good = d == null ? null : m.higherBetter ? d > 0 : d < 0;
                  const met = t && best != null ? t.met(e, best) : null;
                  const cell = (policy: string) => {
                    const k = get(kpi, policy);
                    return k ? <>{fmt(k.mean, m.fmt)} <span style={{ color: "var(--neutral)", fontSize: 12 }}>± {fmt(Math.abs(k.ci_high - k.mean), m.fmt)}</span></> : "–";
                  };
                  return (
                    <tr key={kpi}>
                      <td>{m.label}</td>
                      <td>{cell("baseline_a")}</td>
                      <td>{cell("baseline_b")}</td>
                      <td><b>{cell("engine")}</b></td>
                      <td style={{ color: good == null ? undefined : good ? "var(--success)" : "var(--danger)" }}>
                        {d == null ? "–" : <>{fmtDelta(d, m.fmt)} <span style={{ fontSize: 12 }}>{ci(e, m.fmt)}</span></>}
                      </td>
                      <td>{t?.text ?? "–"}</td>
                      <td>{met == null ? "–" : met ? <span style={{ color: "var(--success)" }}>✓ met</span> : <span style={{ color: "var(--danger)" }}>✗ not met</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {worse.length > 0 && (
            <div className="card" style={{ marginTop: 12, borderColor: "var(--danger)" }}>
              <h3 style={{ marginTop: 0 }}>Where the engine is worse, and why</h3>
              {worse.map(({ kpi, e }) => (
                <p key={kpi}>
                  <b>{metaOf(kpi).label}</b>: {fmtDelta(e.delta_vs_best_baseline!, metaOf(kpi).fmt)} vs the better baseline{" "}
                  {ci(e, metaOf(kpi).fmt)}. {WORSENS_CAUSE[kpi] ?? ""}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Frontier & ablation

const PARAM_LABEL: Record<string, string> = { pi_mult: "stockout weight ×", service_level: "service level", cover_days: "cover days" };
const ABLATION_TEXT: Record<string, string> = {
  abl_no_expiry: "Expiry and write-off terms removed",
  abl_no_truck_steps: "Linear freight: no whole-truck steps, no PTL minimum",
  abl_naive_forecast: "Seasonal-naive forecast instead of the full model",
  abl_no_credit: "Credit constraint removed (the simulator still cuts it)",
  abl_uniform_service: "One service level for every SKU",
  abl_home_depot: "Home-depot sourcing only",
};

function FrontierChart({ points }: { points: FrontierPoint[] }) {
  const W = 680, H = 380, L = 70, R = 24, T = 20, B = 52;
  const xs = points.map((p) => p.cost_to_serve_inr), ys = points.map((p) => p.fill_rate);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)], [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const padX = (x1 - x0) * 0.08 || 1, padY = (y1 - y0) * 0.12 || 0.01;
  const sx = (v: number) => L + ((v - (x0 - padX)) / (x1 - x0 + 2 * padX)) * (W - L - R);
  const sy = (v: number) => H - B - ((v - (y0 - padY)) / (y1 - y0 + 2 * padY)) * (H - T - B);
  const policies = [...new Set(points.map((p) => p.policy))];
  const ticks = (a: number, b: number) => Array.from({ length: 5 }, (_, i) => a + ((b - a) * i) / 4);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Fill rate against cost to serve" style={{ width: "100%", maxWidth: 760 }}>
      {ticks(x0 - padX, x1 + padX).map((v) => (
        <g key={`x${v}`}>
          <line x1={sx(v)} x2={sx(v)} y1={T} y2={H - B} stroke="var(--border)" />
          <text x={sx(v)} y={H - B + 18} textAnchor="middle" fontSize="11" fill="var(--neutral)">{inr(v)}</text>
        </g>
      ))}
      {ticks(y0 - padY, y1 + padY).map((v) => (
        <g key={`y${v}`}>
          <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} stroke="var(--border)" />
          <text x={L - 8} y={sy(v) + 4} textAnchor="end" fontSize="11" fill="var(--neutral)">{(v * 100).toFixed(1)}%</text>
        </g>
      ))}
      <text x={(L + W - R) / 2} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--text)">Total cost to serve (lower is better)</text>
      <text transform={`translate(16 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="var(--text)">Fill rate (higher is better)</text>
      {policies.map((pol) => {
        const pts = points.filter((p) => p.policy === pol).sort((a, b) => a.value - b.value);
        const colour = POLICY_COLOUR[pol] ?? "var(--neutral)";
        return (
          <g key={pol}>
            <polyline fill="none" stroke={colour} strokeWidth="2" strokeDasharray={pol === "baseline_b" ? "6 4" : undefined} points={pts.map((p) => `${sx(p.cost_to_serve_inr)},${sy(p.fill_rate)}`).join(" ")} />
            {pts.map((p) => (
              <g key={p.value}>
                <circle cx={sx(p.cost_to_serve_inr)} cy={sy(p.fill_rate)} r={5} fill={colour}>
                  <title>{`${POLICY_LABEL[pol] ?? pol}: ${PARAM_LABEL[p.param] ?? p.param} ${p.value} → fill ${(p.fill_rate * 100).toFixed(1)}%, cost ${inr(p.cost_to_serve_inr)}`}</title>
                </circle>
                <text x={sx(p.cost_to_serve_inr) + 7} y={sy(p.fill_rate) - 6} fontSize="10" fill="var(--neutral)">{p.value}</text>
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function AblationBars({ rows }: { rows: AblationRow[] }) {
  const max = Math.max(...rows.map((r) => Math.max(Math.abs(r.ci_low), Math.abs(r.ci_high), Math.abs(r.delta_cost_to_serve_inr))), 1);
  const pos = (v: number) => 50 + (v / max) * 48;
  return (
    <div className="card">
      {rows.map((r) => (
        <div key={r.variant} style={{ display: "grid", gridTemplateColumns: "minmax(180px, 280px) 1fr 110px", gap: 12, alignItems: "center", padding: "6px 0" }}>
          <div>{ABLATION_TEXT[r.variant] ?? r.variant}</div>
          <svg viewBox="0 0 100 14" preserveAspectRatio="none" style={{ width: "100%", height: 22 }} aria-label={`${r.variant} cost change with interval`}>
            <line x1="50" x2="50" y1="0" y2="14" stroke="var(--neutral)" strokeWidth="0.4" />
            <rect x={Math.min(50, pos(r.delta_cost_to_serve_inr))} width={Math.abs(pos(r.delta_cost_to_serve_inr) - 50)} y="3" height="8"
              fill={r.delta_cost_to_serve_inr > 0 ? "var(--danger)" : "var(--success)"} />
            <line x1={pos(r.ci_low)} x2={pos(r.ci_high)} y1="7" y2="7" stroke="var(--text)" strokeWidth="0.6" />
          </svg>
          <b style={{ color: r.delta_cost_to_serve_inr > 0 ? "var(--danger)" : "var(--success)" }}>
            {r.delta_cost_to_serve_inr > 0 ? "+" : "−"}{inr(Math.abs(r.delta_cost_to_serve_inr)).replace("−", "")}
          </b>
        </div>
      ))}
    </div>
  );
}

export function FrontierPage() {
  const ex = useExperiment();
  const [state, setState] = useState<OpeningState>("imbalanced");
  const res = ex.results;
  const points = (res?.frontier ?? []).filter((p) => p.opening_state === state);
  const ablation = (res?.ablation ?? []).filter((a) => a.opening_state === state);
  const params = [...new Set(points.map((p) => `${POLICY_LABEL[p.policy] ?? p.policy}: ${PARAM_LABEL[p.param] ?? p.param}`))];
  return (
    <div>
      <h2>Frontier & ablation</h2>
      <div className="row"><Toggle value={state} onChange={setState} /></div>
      <ErrorText error={ex.error} />
      <StatusLine ex={ex} />
      {res && (
        <>
          <h3>Fill rate against cost to serve</h3>
          <p style={{ color: "var(--neutral)" }}>
            Each line is one policy swept over its own tuning knob ({params.join("; ") || "no sweep in this run"}). A point further up and left is better.
            The default setting of each policy is the middle of its line; the numbers next to the points are the knob values.
          </p>
          {points.length > 0 ? (
            <>
              <FrontierChart points={points} />
              <div className="row" style={{ gap: 16, marginTop: 4 }}>
                {[...new Set(points.map((p) => p.policy))].map((p) => (
                  <span key={p}><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 6, background: POLICY_COLOUR[p], marginRight: 6 }} />{POLICY_LABEL[p] ?? p}</span>
                ))}
              </div>
            </>
          ) : <p>No frontier points in this run.</p>}

          <h3>What each mechanism is worth</h3>
          <p style={{ color: "var(--neutral)" }}>
            Cost to serve when one mechanism is switched off, relative to the full engine on the same seeds. A red bar to the right means the
            mechanism saves that much; a green bar to the left means the engine does better without it; the line is the 90% interval.
          </p>
          {ablation.length > 0 ? (
            <>
              <AblationBars rows={ablation} />
              <div className="table-wrap card" style={{ marginTop: 12 }}>
                <table>
                  <thead><tr><th>Switched off</th><th>Δ cost to serve (90% CI)</th><th>Δ fill rate</th><th>Δ wastage</th></tr></thead>
                  <tbody>
                    {ablation.map((a) => (
                      <tr key={a.variant}>
                        <td>{ABLATION_TEXT[a.variant] ?? a.variant}</td>
                        <td>{a.delta_cost_to_serve_inr > 0 ? "+" : "−"}{inr(Math.abs(a.delta_cost_to_serve_inr)).replace("−", "")} <span style={{ fontSize: 12 }}>[{inr(a.ci_low)}, {inr(a.ci_high)}]</span></td>
                        <td>{a.delta_fill_rate_pp > 0 ? "+" : ""}{a.delta_fill_rate_pp.toFixed(1)} pp</td>
                        <td>{a.delta_wastage_inr > 0 ? "+" : "−"}{inr(Math.abs(a.delta_wastage_inr)).replace("−", "")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : <p>No ablation rows in this run.</p>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Map, Assumptions

const RC_COLOUR: Record<string, string> = {
  CHEAPEST_SOURCE: "var(--rc-cheapest-source)", EXPIRY_PUSH: "var(--rc-expiry-push)", CLIFF_RESCUE: "var(--rc-cliff-rescue)",
  FTL_TOPUP: "var(--rc-ftl-topup)", FESTIVAL_UPLIFT: "var(--rc-festival-uplift)", WEATHER_SHIFT: "var(--rc-weather-shift)",
};

/** Network map (FR-14): nodes at their real coordinates, arcs sized by cases and coloured by the dominant reason code. No basemap tiles, so it works offline. */
export function MapPage({ plan }: { plan: Plan | null }) {
  const scenario = useLoad(() => (plan ? api.scenario(plan.scenario_id) : Promise.resolve(null)), [plan?.scenario_id]);
  const [selected, setSelected] = useState<string | null>(null);
  const [noWebgl, setNoWebgl] = useState(false);
  const nodes = scenario.data?.nodes ?? [];
  const W = 600, H = 600, K = 20, LON0 = 68, LAT1 = 36, COS = 0.93;
  const pos = (n: { lat: number; lon: number }) => ({ x: 20 + (n.lon - LON0) * COS * K, y: 20 + (LAT1 - n.lat) * K });
  const lanes = useMemo(() => {
    const m = new Map<string, { from: string; to: string; cases: number; byCode: Map<string, number> }>();
    for (const l of plan?.lines ?? []) {
      const k = `${l.from_id}>${l.to_id}`;
      const cur = m.get(k) ?? { from: l.from_id, to: l.to_id, cases: 0, byCode: new Map<string, number>() };
      cur.cases += l.cases;
      const code = l.reasons?.[0]?.code ?? "";
      cur.byCode.set(code, (cur.byCode.get(code) ?? 0) + l.cases);
      m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => b.cases - a.cases);
  }, [plan]);
  const byId = new Map(nodes.map((n) => [n.node_id, n]));
  const max = Math.max(...lanes.map((l) => l.cases), 1);
  const dominant = (l: (typeof lanes)[number]) => [...l.byCode.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  const shownLines = (plan?.lines ?? []).filter((l) => !selected || `${l.from_id}>${l.to_id}` === selected);
  return (
    <div>
      <h2>Network map</h2>
      {!plan ? <p>Generate a plan first (Plan tab).</p> : (
        <>
          <ErrorText error={scenario.error} />
          <p style={{ color: "var(--neutral)" }}>
            Squares are depots, circles are distributors. Arc width is cases shipped; colour is the main reason code on the lane. Click an arc to filter the lines below. The background map needs a network connection; without one the lanes still show on a plain background.
          </p>
          {noWebgl ? (
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Plan lanes on a map of India" style={{ width: "100%", maxWidth: 640, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8 }}>
            {lanes.map((l) => {
              const a = byId.get(l.from), b = byId.get(l.to);
              if (!a || !b) return null;
              const p = pos(a), q = pos(b);
              const cx = (p.x + q.x) / 2 + (q.y - p.y) * 0.12, cy = (p.y + q.y) / 2 - (q.x - p.x) * 0.12;
              const key = `${l.from}>${l.to}`;
              return (
                <path key={key} d={`M${p.x},${p.y} Q${cx},${cy} ${q.x},${q.y}`} fill="none" strokeLinecap="round"
                  stroke={RC_COLOUR[dominant(l)] ?? "var(--rc-limited)"} strokeWidth={1 + 12 * Math.sqrt(l.cases / max)}
                  opacity={selected && selected !== key ? 0.12 : 0.65} style={{ cursor: "pointer" }}
                  onClick={() => setSelected(selected === key ? null : key)}>
                  <title>{`${a.city} → ${b.city}: ${l.cases.toLocaleString("en-IN")} cases, mainly ${dominant(l) || "n/a"}`}</title>
                </path>
              );
            })}
            {nodes.map((n) => {
              const p = pos(n);
              return n.type === "depot" ? (
                <g key={n.node_id}>
                  <rect x={p.x - 7} y={p.y - 7} width={14} height={14} fill="var(--primary)" stroke="var(--surface)" strokeWidth="2" />
                  <text x={p.x + 10} y={p.y + 4} fontSize="11" fontWeight="600" fill="var(--text)">{n.city}</text>
                </g>
              ) : (
                <g key={n.node_id}>
                  <circle cx={p.x} cy={p.y} r={4.5} fill="var(--neutral)" stroke="var(--surface)" strokeWidth="1.5" />
                  <text x={p.x + 7} y={p.y + 3} fontSize="9" fill="var(--text)">{n.city}</text>
                </g>
              );
            })}
          </svg>
          ) : (
            <Suspense fallback={<p>Loading map…</p>}>
            <NetworkMap
              nodes={nodes.map((n) => ({ id: n.node_id, city: n.city, lat: n.lat, lon: n.lon, depot: n.type === "depot" }))}
              lanes={lanes.map((l) => ({ key: `${l.from}>${l.to}`, from: l.from, to: l.to, cases: l.cases, code: dominant(l) }))}
              selected={selected} onSelect={setSelected} onUnsupported={() => setNoWebgl(true)} />
            </Suspense>
          )}
          <div className="row" style={{ gap: 12, margin: "6px 0" }}>
            {Object.entries(RC_COLOUR).map(([code, colour]) => (
              <span key={code} style={{ fontSize: 12 }}><span style={{ display: "inline-block", width: 10, height: 10, background: colour, marginRight: 4 }} />{code}</span>
            ))}
            {selected && <button className="secondary" onClick={() => setSelected(null)}>Show all lanes</button>}
          </div>
          <div className="table-wrap card">
            <table>
              <thead><tr><th>SKU</th><th>From → To</th><th>Cases</th><th>Reasons</th></tr></thead>
              <tbody>
                {shownLines.slice(0, 80).map((l) => (
                  <tr key={l.line_id}>
                    <td>{l.sku_name}</td><td>{l.from_id} → {l.to_id}</td><td>{l.cases.toLocaleString("en-IN")}</td>
                    <td><ReasonChips reasons={l.reasons} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shownLines.length > 80 && <p style={{ color: "var(--neutral)" }}>Showing 80 of {shownLines.length} lines.</p>}
          </div>
        </>
      )}
    </div>
  );
}

export function AssumptionsPage() {
  const rows = useLoad(api.assumptions, []);
  const [q, setQ] = useState("");
  const [onlyJudgment, setOnlyJudgment] = useState(false);
  const data: AssumptionRow[] = rows.data ?? [];
  const isJudgment = (r: AssumptionRow) => !r.source || r.source === "judgment";
  const shown = data.filter((r) => (!onlyJudgment || isJudgment(r)) &&
    (q === "" || `${r.parameter} ${r.source ?? ""} ${r.rationale ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const sourced = data.filter((r) => r.source && r.source !== "judgment").length;
  return (
    <div>
      <h2>Assumptions</h2>
      <p style={{ color: "var(--neutral)" }}>
        Every business number the engine uses, from <span className="mono">config.yaml</span>. {sourced} of {data.length} rows cite a source;
        the rest are marked as judgment.
      </p>
      <div className="row">
        <label>Search<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. diesel, MRSL, credit" /></label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={onlyJudgment} onChange={(e) => setOnlyJudgment(e.target.checked)} /> Judgment only
        </label>
        <span>{shown.length} shown</span>
      </div>
      <ErrorText error={rows.error} />
      <div className="table-wrap card" style={{ marginTop: 8 }}>
        <table>
          <thead><tr><th>Parameter</th><th>Value</th><th>Unit</th><th>Source</th><th>Why</th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.parameter}>
                <td className="mono">{r.parameter}</td>
                <td className="mono" style={{ maxWidth: 260, overflowWrap: "anywhere" }}>{typeof r.value === "object" ? JSON.stringify(r.value) : String(r.value)}</td>
                <td>{r.unit ?? ""}</td>
                <td>{r.source ? (r.source === "judgment" ? <span className="badge" style={{ background: "var(--warning)", color: "#000" }}>judgment</span> : r.source) : <span className="badge">no source</span>}</td>
                <td>{r.rationale ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
