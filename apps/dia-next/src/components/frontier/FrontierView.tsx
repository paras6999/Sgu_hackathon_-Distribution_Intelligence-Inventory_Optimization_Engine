"use client";

import { useMemo, useState } from "react";
import type { OpeningState } from "@dia/types";
import { ExperimentNotice } from "@/components/results/ExperimentNotice";
import { OpeningToggle } from "@/components/results/OpeningToggle";
import { useExperiment } from "@/hooks/useExperiment";
import { usePageContext } from "@/hooks/usePageContext";
import { useUiActions } from "@/hooks/useUiActions";
import { AblationBars, AblationTable } from "./AblationBars";
import { FrontierChart } from "./FrontierChart";
import styles from "./Frontier.module.css";

const PROMPTS = ["What does the expiry part save?", "Why was one service level cheaper?"];

/** Cost against service for each policy's settings, and what each part of the engine is worth. */
export function FrontierView() {
  const ex = useExperiment();
  const [opening, setOpening] = useState<OpeningState>("imbalanced");

  useUiActions((action) => {
    if (action.type === "set_filters" && action.opening_state) setOpening(action.opening_state);
  });
  usePageContext({
    page: "frontier",
    context: { experiment_id: ex.id ?? undefined, opening_state: opening },
    prompts: PROMPTS,
  });

  const points = useMemo(
    () => (ex.results?.frontier ?? []).filter((p) => p.opening_state === opening),
    [ex.results, opening],
  );
  const ablation = useMemo(
    () => (ex.results?.ablation ?? []).filter((a) => a.opening_state === opening),
    [ex.results, opening],
  );
  const busy = ex.info?.status === "queued" || ex.info?.status === "running";
  const loaded = ex.results !== null;

  return (
    <section className="record" data-page="frontier" data-ready={loaded ? "true" : "false"}>
      <div className="record-head">
        <div>
          <div className="kind">Evaluation</div>
          <h1>Cost against service</h1>
        </div>
        <span className="spacer" />
        <OpeningToggle value={opening} onChange={setOpening} />
      </div>

      <ExperimentNotice ex={ex} />
      {!loaded && !ex.error && !busy && <p className="empty">Loading the evaluation run…</p>}

      {loaded && (
        <div className={styles.body}>
          <div className="box">
            <h2>Demand met against cost to serve</h2>
            {points.length > 0 ? (
              <>
                <FrontierChart points={points} />
                <p className="caption">
                  Further up and to the left is better. Each line is one policy at different settings.
                </p>
              </>
            ) : (
              <p className="empty">No settings to plot for this starting stock.</p>
            )}
          </div>

          <div className="box">
            <h2>What each part of the engine is worth</h2>
            {ablation.length > 0 ? (
              <>
                <AblationBars rows={ablation} />
                <p className="caption">
                  A bar to the right means the engine saves that much with this part on. A bar to the left means the
                  engine did better without it.
                </p>
                <div className={styles.tableGap}>
                  <AblationTable rows={ablation} />
                </div>
              </>
            ) : (
              <p className="empty">No results for each part of the engine in this run.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
