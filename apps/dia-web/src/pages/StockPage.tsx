/**
 * Stock watch: stock expected to expire before it sells (PRD FR-20), and the day-by-day stock of one SKU at one distributor
 * under each policy (PRD FR-21). The trajectory comes from the cached experiment; the page polls it until the run finishes.
 */
import type { AtRisk, ExperimentInfo, OpeningState, Plan, TrajectorySeries } from "@dia/types";
import { useEffect, useState } from "react";
import { ApiError, api } from "../api";
import { EmptyState, ErrorText, PageHeader, Segmented, useLoad } from "../components/ui";
import { POLICY_COLOUR, POLICY_LABEL } from "./AnalyticsPages";

const AS_OF = "2025-09-29"; // first test day, same default as the Plan page
const POLL_MS = 5000;

const ts = (date: string) => Date.parse(`${date}T00:00:00Z`);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const rowKey = (r: AtRisk) => `${r.dist_id}|${r.sku_id}|${r.lot_id ?? ""}|${r.expiry}`;

export function StockPage({ plan }: { plan: Plan | null }) {
  const scenarios = useLoad(api.scenarios, []);
  const sid = plan?.scenario_id ?? scenarios.data?.[0] ?? "";
  const scenario = useLoad(() => (sid ? api.scenario(sid) : Promise.resolve(null)), [sid]);
  const skus = scenario.data?.skus ?? [];
  const distributors = (scenario.data?.nodes ?? []).filter((n) => n.type === "distributor");

  // Section A: stock at risk on the chosen date.
  const [asOf, setAsOf] = useState(AS_OF);
  const risk = useLoad(() => (sid && asOf ? api.atRisk(sid, asOf) : Promise.resolve([] as AtRisk[])), [sid, asOf]);
  const rows = risk.data ?? [];
  const [picked, setPicked] = useState<string | null>(null);

  // Section B selections. An empty value means the first SKU or distributor in the scenario.
  const [skuPick, setSkuPick] = useState("");
  const [distPick, setDistPick] = useState("");
  const [state, setState] = useState<OpeningState>("neutral");
  const [seed, setSeed] = useState(1);
  const sku = skuPick || skus[0]?.sku_id || "";
  const dist = distPick || distributors[0]?.node_id || "";

  const [expId, setExpId] = useState<string | null>(null);
  const [startError, setStartError] = useState<unknown>();
  const [info, setInfo] = useState<ExperimentInfo | null>(null);
  const [pollError, setPollError] = useState<unknown>();
  const done = info?.status === "done";

  // startExperiment returns the cached run's id when the headline run exists.
  useEffect(() => {
    let live = true;
    api.startExperiment().then((r) => live && setExpId(r.experiment_id), (e) => live && setStartError(e));
    return () => { live = false; };
  }, []);

  // Poll every 5 s while the run is queued or running. Unmounting clears the pending timer.
  useEffect(() => {
    if (!expId) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = () => {
      api.experiment(expId).then((i) => {
        if (!live) return;
        setInfo(i);
        if (i.status === "queued" || i.status === "running") timer = setTimeout(poll, POLL_MS);
      }, (e) => live && setPollError(e));
    };
    poll();
    return () => { live = false; clearTimeout(timer); };
  }, [expId]);

  const traj = useLoad(
    () => (expId && done && sku && dist ? api.trajectory(expId, { sku_id: sku, dist_id: dist, opening_state: state, seed }) : Promise.resolve(null)),
    [expId, done, sku, dist, state, seed],
  );
  const noTrajectory = traj.error instanceof ApiError && traj.error.status === 404;
  const skuName = skus.find((s) => s.sku_id === sku)?.name ?? sku;
  const distCity = distributors.find((n) => n.node_id === dist)?.city ?? dist;

  function pick(r: AtRisk) {
    setPicked(rowKey(r)); setSkuPick(r.sku_id); setDistPick(r.dist_id);
  }

  return (
    <section>
      <PageHeader title="Stock watch" sub="Stock likely to expire before it sells (FR-20), and how one SKU at one distributor runs down day by day under each policy (FR-21)." />
      <ErrorText error={scenarios.error ?? scenario.error ?? risk.error} />

      <h2>Stock at risk</h2>
      <div className="card toolbar">
        <label>As of
          <input type="date" value={asOf} min="2025-09-29" max="2025-12-21" onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <button className="secondary" onClick={risk.reload}>Refresh</button>
      </div>
      {rows.length > 0 && (
        <div className="table-wrap scroll">
          <table>
            <thead>
              <tr>
                <th>Distributor</th><th>SKU</th><th>Expiry</th><th className="num">Days left</th><th className="num">Stock (cases)</th>
                <th className="num">Expected expired (cases)</th><th className="num">Expected days to sell</th><th>Suggested action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = rowKey(r);
                return (
                  <tr key={key} className={`clickable ${picked === key ? "selected" : ""}`} tabIndex={0}
                    onClick={() => pick(r)} onKeyDown={(e) => { if (e.key === "Enter") pick(r); }}>
                    <td>{r.dist_city}</td>
                    <td>{r.sku_name}</td>
                    <td className="mono">{r.expiry}</td>
                    <td className="num">{r.days_left}</td>
                    <td className="num">{r.stock_cases.toLocaleString("en-IN")}</td>
                    <td className="num">{r.expected_expired_cases.toFixed(1)}</td>
                    <td className="num">{r.expected_days_to_sell.toFixed(1)}</td>
                    <td>{r.suggested_action}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {risk.data && rows.length === 0 && (
        <EmptyState title="No stock at risk on this date">Nothing is expected to expire before it sells on {asOf}. Pick another date in the test window.</EmptyState>
      )}

      <h2>Stock trajectory</h2>
      <p className="muted">Closing stock by day for one SKU at one distributor under each policy, on one seed. Click a row above to load its SKU and distributor.</p>
      <div className="card toolbar">
        <label>SKU
          <select value={sku} onChange={(e) => setSkuPick(e.target.value)}>
            {skus.map((s) => <option key={s.sku_id} value={s.sku_id}>{s.name}</option>)}
          </select>
        </label>
        <label>Distributor
          <select value={dist} onChange={(e) => setDistPick(e.target.value)}>
            {distributors.map((n) => <option key={n.node_id} value={n.node_id}>{n.city}</option>)}
          </select>
        </label>
        <div className="field">
          <span>Opening state</span>
          <Segmented label="Opening state" value={state} onChange={setState}
            options={[{ value: "neutral", label: "Neutral start" }, { value: "imbalanced", label: "Imbalanced start" }]} />
        </div>
        <label>Seed
          <select value={seed} onChange={(e) => setSeed(Number(e.target.value))}>
            <option value={1}>1</option>
            <option value={2}>2</option>
          </select>
        </label>
      </div>

      <ErrorText error={startError ?? pollError ?? (noTrajectory ? undefined : traj.error)} />
      {!expId && !startError && <div className="callout" role="status"><p>Connecting to the experiment…</p></div>}
      {info && (info.status === "queued" || info.status === "running") && (
        <div className="callout" role="status">
          <p>{info.status === "queued" ? "Experiment queued." : `Experiment running, ${info.progress_pct.toFixed(0)}% done.`} A full engine run takes about 20 to 40 minutes. This section updates by itself.</p>
        </div>
      )}
      {info?.status === "failed" && <p className="error">Experiment {expId} failed: {info.error ?? "no error message"}</p>}
      {done && traj.data === undefined && !traj.error && <div className="callout" role="status"><p>Loading trajectory…</p></div>}
      {done && noTrajectory && (
        <EmptyState title="No trajectory for this selection">
          The finished experiment has no day-by-day log for this SKU, distributor, opening state and seed. Logs are kept for seeds 1 and 2 only.
        </EmptyState>
      )}
      {traj.data && (traj.data.series.some((s) => s.points.length > 0) ? (
        <>
          <div className="card">
            <div className="card-h"><h3>Closing stock: {skuName} at {distCity}, seed {traj.data.seed}, {state} start</h3></div>
            <TrajectoryChart series={traj.data.series} />
            <div className="legend">
              {traj.data.series.map((s) => (
                <span key={s.policy}><i style={{ background: POLICY_COLOUR[s.policy] ?? "var(--neutral)" }} />{POLICY_LABEL[s.policy] ?? s.policy}</span>
              ))}
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Policy</th><th className="num">Sales (cases)</th><th className="num">Lost (cases)</th><th className="num">Expired (cases)</th></tr></thead>
              <tbody>
                {traj.data.series.map((s) => (
                  <tr key={s.policy}>
                    <td>{POLICY_LABEL[s.policy] ?? s.policy}</td>
                    <td className="num">{Math.round(sum(s.points.map((p) => p.sales_cases))).toLocaleString("en-IN")}</td>
                    <td className="num">{Math.round(sum(s.points.map((p) => p.lost_cases))).toLocaleString("en-IN")}</td>
                    <td className="num">{Math.round(sum(s.points.map((p) => p.expired_cases))).toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : <EmptyState title="Empty trajectory">The experiment returned no days for this selection.</EmptyState>)}
    </section>
  );
}

/** Closing stock by date, one line per policy. Same colours and dashed Baseline B line as the frontier chart. */
function TrajectoryChart({ series }: { series: TrajectorySeries[] }) {
  const W = 680, H = 340, L = 64, R = 20, T = 16, B = 44;
  const times = series.flatMap((s) => s.points.map((p) => ts(p.date)));
  const [t0, t1] = [Math.min(...times), Math.max(...times)];
  const top = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.closing_cases)));
  const sx = (t: number) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const sy = (v: number) => H - B - (v / top) * (H - T - B);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Closing stock by day for each policy" className="chart">
      {[0, 1, 2, 3, 4].map((i) => {
        const v = (top * i) / 4, t = t0 + ((t1 - t0) * i) / 4;
        return (
          <g key={i}>
            <line x1={L} x2={W - R} y1={sy(v)} y2={sy(v)} stroke="var(--border)" />
            <text x={L - 8} y={sy(v) + 4} textAnchor="end" fontSize="11" fill="var(--neutral)">{Math.round(v).toLocaleString("en-IN")}</text>
            <text x={sx(t)} y={H - B + 18} textAnchor="middle" fontSize="11" fill="var(--neutral)">{new Date(t).toISOString().slice(0, 10)}</text>
          </g>
        );
      })}
      <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="var(--text)">Date</text>
      <text transform={`translate(16 ${(T + H - B) / 2}) rotate(-90)`} textAnchor="middle" fontSize="12" fill="var(--text)">Closing stock (cases)</text>
      {series.map((s) => (
        <polyline key={s.policy} fill="none" stroke={POLICY_COLOUR[s.policy] ?? "var(--neutral)"} strokeWidth="2"
          strokeDasharray={s.policy === "baseline_b" ? "6 4" : undefined}
          points={s.points.map((p) => `${sx(ts(p.date))},${sy(p.closing_cases)}`).join(" ")} />
      ))}
    </svg>
  );
}
