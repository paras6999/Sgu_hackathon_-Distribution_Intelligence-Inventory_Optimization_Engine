"use client";

import { useMemo, useState } from "react";
import type { KpiSummary, OpeningState } from "@dia/types";
import { useExperiment } from "@/hooks/useExperiment";
import { usePageContext } from "@/hooks/usePageContext";
import { useUiActions } from "@/hooks/useUiActions";
import {
  bestPolicyValue,
  changeTone,
  engineIsWorse,
  findKpi,
  formatKpi,
  formatKpiChange,
  formatRelative,
  HEADLINE,
  KPI_ORDER,
  kpiLabel,
  metaOf,
  WORSENS_CAUSE,
} from "@/lib/results";
import { ExperimentNotice } from "./ExperimentNotice";
import { OpeningToggle } from "./OpeningToggle";
import { Scorecard } from "./Scorecard";
import styles from "./Results.module.css";

const PROMPTS = ["Analyse these results", "Why is demand met lower?", "Show the neutral start"];

/** One headline figure: the engine's value and its gap to the better policy. */
function HeadlineCell({ kpi, label, rows }: { kpi: string; label: string; rows: KpiSummary[] }) {
  const engine = findKpi(rows, kpi, "engine");
  if (!engine) {
    return (
      <div>
        <div className="l">{label}</div>
        <div className="v">–</div>
      </div>
    );
  }
  const meta = metaOf(kpi);
  const delta = engine.delta_vs_best_baseline ?? null;
  const best = bestPolicyValue(engine);
  const tone = changeTone(kpi, delta);
  const relative = meta.fmt === "pct" || delta === null || best === null ? "" : formatRelative(delta, best);
  return (
    <div>
      <div className="l">{label}</div>
      <div className="v">{formatKpi(engine.mean, meta.fmt)}</div>
      <div className="n">
        {delta === null ? (
          "No comparison in this run"
        ) : (
          <span className={tone === "good" ? "delta-up" : tone === "bad" ? "delta-down" : "delta-0"}>
            {formatKpiChange(delta, meta.fmt)}
            {relative && ` (${relative})`} against the better policy
          </span>
        )}
      </div>
    </div>
  );
}

/** The engine against the better of two simple policies, with the stored run's numbers only. */
export function ResultsView() {
  const ex = useExperiment();
  const [opening, setOpening] = useState<OpeningState>("imbalanced");

  useUiActions((action) => {
    if (action.type === "set_filters" && action.opening_state) setOpening(action.opening_state);
  });
  usePageContext({
    page: "results",
    context: { experiment_id: ex.id ?? undefined, opening_state: opening },
    prompts: PROMPTS,
  });

  const rows = useMemo(
    () => (ex.results?.kpis ?? []).filter((kpi) => kpi.opening_state === opening),
    [ex.results, opening],
  );
  const seeds = findKpi(rows, "cost_to_serve_inr", "engine")?.n_seeds;
  const worse = KPI_ORDER.flatMap((kpi) => {
    const engine = findKpi(rows, kpi, "engine");
    return engine && engineIsWorse(kpi, engine) ? [{ kpi, engine }] : [];
  });
  const busy = ex.info?.status === "queued" || ex.info?.status === "running";
  const loaded = ex.results !== null;

  return (
    <section className="record" data-page="results" data-ready={loaded ? "true" : "false"}>
      <div className="record-head">
        <div>
          <div className="kind">Evaluation</div>
          <h1>Results: engine against the better of two simple policies</h1>
          <p className={styles.sub}>
            {seeds ? `Means over ${seeds} seeds with 90% ranges.` : "Means over the stored seeds with 90% ranges."} Every
            policy faces the same demand, delays and promotions.
          </p>
        </div>
        <span className="spacer" />
        <OpeningToggle value={opening} onChange={setOpening} />
        <button type="button" className="btn" onClick={ex.reload}>
          Reload
        </button>
      </div>

      <ExperimentNotice ex={ex} />
      {!loaded && !ex.error && !busy && <p className="empty">Loading the evaluation run…</p>}

      {rows.length > 0 && (
        <div className="strip">
          {HEADLINE.map((item) => (
            <HeadlineCell key={item.kpi} kpi={item.kpi} label={item.label} rows={rows} />
          ))}
        </div>
      )}

      {loaded && rows.length === 0 && <p className="empty">No results for this starting stock.</p>}

      {rows.length > 0 && (
        <div className={styles.body}>
          {worse.length > 0 ? (
            <div className="callout">
              <p className={styles.calloutTitle}>Where the engine is worse, and why</p>
              {worse.map(({ kpi, engine }) => (
                <p key={kpi} className={styles.calloutLine}>
                  <b>{kpiLabel(kpi)}</b>: {formatKpiChange(engine.delta_vs_best_baseline ?? 0, metaOf(kpi).fmt)} against
                  the better policy. {WORSENS_CAUSE[kpi] ?? ""}
                </p>
              ))}
            </div>
          ) : (
            <div className="callout">
              The engine is not worse than the better policy on any measure in this run.
            </div>
          )}

          <Scorecard rows={rows} state={opening} />

          <p className="caption">Simulated sales and stock; real weather. Numbers are the stored run&apos;s, not a forecast.</p>
        </div>
      )}
    </section>
  );
}
