"use client";

import { useState } from "react";
import { useScenario } from "@/hooks/useScenario";
import { usePageContext } from "@/hooks/usePageContext";
import { useUiActions } from "@/hooks/useUiActions";
import { formatPercent } from "@/lib/format";
import { HistoryChart } from "./HistoryChart";
import { LearnedPanel } from "./LearnedPanel";
import { useDemandData } from "./useDemandData";
import styles from "./Demand.module.css";

const PROMPTS = ["Explain the forecast accuracy", "Show Kolkata cola", "Why is the heat effect low?"];

/** The API sends fractions (0.12 is 12%). The screen shows percentages. */
const pct = (fraction: number) => formatPercent(fraction * 100);

/** Demand analysis: the weekly history, how closely the forecast tracked it, and what the model learned. */
export function DemandPage() {
  const { scenarioId, scenario, error: scenarioError } = useScenario();
  const [dist, setDist] = useState("");
  const [sku, setSku] = useState("");
  const { history, effects, metrics } = useDemandData(scenarioId, dist, sku);

  const distributors = (scenario?.nodes ?? []).filter((n) => n.type === "distributor");
  const products = scenario?.skus ?? [];

  usePageContext({
    page: "demand",
    context: { dist_id: dist || undefined, sku_id: sku || undefined },
    prompts: PROMPTS,
  });

  useUiActions((action) => {
    if (action.type !== "set_filters") return;
    if (action.dist_id !== undefined && distributors.some((n) => n.node_id === action.dist_id)) {
      setDist(action.dist_id);
    }
    if (action.sku_id !== undefined && products.some((s) => s.sku_id === action.sku_id)) {
      setSku(action.sku_id);
    }
  });

  const ready = scenarioError !== null || (history !== null && effects !== null && metrics !== null);
  const m = metrics?.data;
  const improvement = m && m.wape_seasonal_naive > 0 ? 1 - m.wape / m.wape_seasonal_naive : null;

  return (
    <section className="record" data-page="demand" data-ready={ready ? "true" : "false"}>
      <div className="record-head">
        <div>
          <div className="kind">Evaluation</div>
          <h1>Demand analysis</h1>
        </div>
        <span className="spacer" />
        <div className={styles.filters}>
          <label>
            Distributor
            <select value={dist} onChange={(e) => setDist(e.target.value)} disabled={!scenario}>
              <option value="">All distributors</option>
              {distributors.map((n) => (
                <option key={n.node_id} value={n.node_id}>
                  {n.city}
                </option>
              ))}
            </select>
          </label>
          <label>
            Product
            <select value={sku} onChange={(e) => setSku(e.target.value)} disabled={!scenario}>
              <option value="">All products</option>
              {products.map((s) => (
                <option key={s.sku_id} value={s.sku_id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {history?.data && <span className="hint">{history.data.label}</span>}
      </div>

      {scenarioError && <p className="notice error" role="alert">{scenarioError}</p>}
      {history?.error && <p className="notice error" role="alert">{history.error}</p>}
      {effects?.error && <p className="notice error" role="alert">{effects.error}</p>}
      {metrics?.error && <p className="notice error" role="alert">{metrics.error}</p>}

      <div className={`strip ${styles.metrics}`}>
        <div>
          <span className="l">Forecast error</span>
          <div className="v">{m ? pct(m.wape) : "–"}</div>
          <span className="n">{m ? `Last year's pattern: ${pct(m.wape_seasonal_naive)}` : " "}</span>
        </div>
        <div>
          <span className="l">Better than last year&apos;s pattern</span>
          <div className="v">{improvement === null ? "–" : formatPercent(improvement * 100)}</div>
        </div>
        <div>
          <span className="l">Bias</span>
          <div className="v">{m ? `${m.bias > 0 ? "+" : ""}${pct(m.bias)}` : "–"}</div>
          <span className="n">Over (+) or under (−) the actual demand</span>
        </div>
        <div>
          <span className="l">Weeks inside the 80% range</span>
          <div className="v">{m ? pct(m.coverage_p10_p90) : "–"}</div>
          <span className="n">Aim: 80%</span>
        </div>
        <div>
          <span className="l">Forecast error in festival weeks</span>
          <div className="v">{m ? pct(m.wape_festival_weeks) : "–"}</div>
        </div>
      </div>

      <div className={styles.body}>
        <div className="box">
          <h2>Weekly demand and the forecast</h2>
          {history?.data && history.data.weekly.length === 0 && (
            <p className="empty">No history for this selection.</p>
          )}
          {history?.data && history.data.weekly.length > 0 && <HistoryChart history={history.data} />}
          {!history && <p className="empty">Loading demand history…</p>}
        </div>

        {effects?.data && <LearnedPanel effects={effects.data} />}
        {!effects && <p className="empty">Loading what the forecaster learned…</p>}

        <div className={`callout ${styles.callout}`}>
          <b>How to read this</b>
          <p>
            Festival uplifts are recovered closely. The monthly seasonal curve and the heat effect are recovered only
            weakly: the model tracks the season through its weekly level instead, which is why accuracy stays good. The
            accuracy figures above are the real test.
          </p>
          <p>
            The simulator and the model share structure, so the error figures flatter the model. A pilot on real exports
            is the proper check.
          </p>
        </div>
      </div>
    </section>
  );
}
