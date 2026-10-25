"use client";

import { useEffect, useState } from "react";
import type { AtRisk, OpeningState } from "@dia/types";
import { usePageContext } from "@/hooks/usePageContext";
import { useExperiment } from "@/hooks/useExperiment";
import { useScenario } from "@/hooks/useScenario";
import { useUiActions } from "@/hooks/useUiActions";
import { describeError, getAtRisk } from "@/lib/api";
import { AS_OF } from "@/lib/config";
import { formatNumber } from "@/lib/format";
import { AtRiskBox } from "./AtRiskBox";
import { TrajectoryBox } from "./TrajectoryBox";
import styles from "./StockWatch.module.css";

/** Range the at-risk list is shown for in the demo data. */
const MIN_AS_OF = "2025-09-29";
const MAX_AS_OF = "2025-12-21";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PROMPTS = ["Which stock expires first?", "Show Kolkata cola"];

type RiskLoad = { key: string; rows?: AtRisk[]; error?: string };

function Cell({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={warn ? "warn" : undefined}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
    </div>
  );
}

/** Stock close to its shelf-life limit, at depots and distributors, with a stock-over-time box below. */
export function StockWatch() {
  const { scenarioId, scenario, error: scenarioError } = useScenario();
  const experiment = useExperiment();
  const [asOf, setAsOf] = useState(AS_OF);
  const [refreshes, setRefreshes] = useState(0);
  const [risk, setRisk] = useState<RiskLoad | null>(null);
  const [chosenSku, setChosenSku] = useState<string | null>(null);
  const [chosenDist, setChosenDist] = useState<string | null>(null);
  const [opening, setOpening] = useState<OpeningState>("imbalanced");
  const [seed, setSeed] = useState(1);

  useEffect(() => {
    if (!scenarioId) return;
    let active = true;
    const key = `${scenarioId}|${asOf}|${refreshes}`;
    getAtRisk(scenarioId, asOf).then(
      (rows) => {
        if (active) setRisk({ key, rows });
      },
      (err: unknown) => {
        if (active) setRisk({ key, error: describeError(err) });
      },
    );
    return () => {
      active = false;
    };
  }, [scenarioId, asOf, refreshes]);

  const riskKey = `${scenarioId ?? ""}|${asOf}|${refreshes}`;
  const current = risk?.key === riskKey ? risk : null;
  const rows = current?.rows ?? null;
  const riskError = current?.error ?? null;

  const nodes = scenario?.nodes ?? [];
  const skus = scenario?.skus ?? [];
  // Until a row is clicked or the assistant sets a filter, the first product and first distributor are shown.
  const skuId = chosenSku ?? skus[0]?.sku_id ?? null;
  const distId = chosenDist ?? nodes.find((n) => n.type === "distributor")?.node_id ?? null;

  useUiActions((action) => {
    if (action.type !== "set_filters") return;
    if (action.as_of && ISO_DATE.test(action.as_of)) setAsOf(action.as_of);
    if (action.sku_id && skus.some((s) => s.sku_id === action.sku_id)) setChosenSku(action.sku_id);
    if (action.dist_id && nodes.some((n) => n.node_id === action.dist_id)) setChosenDist(action.dist_id);
    if (action.opening_state) setOpening(action.opening_state);
    if (action.seed === 1 || action.seed === 2) setSeed(action.seed);
  });

  usePageContext({
    page: "stock",
    context: {
      as_of: asOf,
      dist_id: distId ?? undefined,
      sku_id: skuId ?? undefined,
      opening_state: opening,
      seed,
      experiment_id: experiment.id ?? undefined,
    },
    prompts: PROMPTS,
  });

  const pick = (row: AtRisk) => {
    setChosenSku(row.sku_id);
    setChosenDist(row.dist_id);
  };

  const count = (n: number | null) => (n === null ? "—" : formatNumber(n));
  const depots = rows ? rows.filter((r) => r.holder_type === "depot").length : null;
  const distributors = rows ? rows.filter((r) => r.holder_type === "distributor").length : null;
  const cases = rows ? rows.reduce((sum, r) => sum + r.stock_cases, 0) : null;

  return (
    <section className={`record ${styles.page}`} data-page="stock" data-ready={current ? "true" : "false"}>
      <div className="record-head">
        <div>
          <div className="kind">Planning cycle</div>
          <h1>Stock watch</h1>
        </div>
        <span className="spacer" />
        <label className={styles.field}>
          As of
          <input
            type="date"
            value={asOf}
            min={MIN_AS_OF}
            max={MAX_AS_OF}
            onChange={(e) => {
              if (e.target.value) setAsOf(e.target.value);
            }}
          />
        </label>
        <button type="button" className="btn" disabled={!scenarioId} onClick={() => setRefreshes((n) => n + 1)}>
          Refresh
        </button>
      </div>
      {scenarioError && (
        <p className="notice error" role="alert">
          {scenarioError}
        </p>
      )}
      <div className={`strip ${styles.four}`}>
        <Cell label="Lots at risk" value={count(rows?.length ?? null)} />
        <Cell label="At depots" value={count(depots)} />
        <Cell label="At distributors" value={count(distributors)} />
        <Cell label="Cases at risk" value={count(cases)} warn={(cases ?? 0) > 0} />
      </div>
      <div className={styles.stack}>
        <AtRiskBox
          rows={rows}
          error={riskError ?? scenarioError}
          selectedSku={chosenSku}
          selectedDist={chosenDist}
          onPick={pick}
        />
        <TrajectoryBox
          experiment={experiment}
          skus={skus}
          nodes={nodes}
          skuId={skuId}
          distId={distId}
          opening={opening}
          seed={seed}
          onSku={setChosenSku}
          onDist={setChosenDist}
          onOpening={setOpening}
          onSeed={setSeed}
        />
      </div>
    </section>
  );
}
