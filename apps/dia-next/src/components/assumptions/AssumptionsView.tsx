"use client";

import { useEffect, useMemo, useState } from "react";
import type { AssumptionRow } from "@dia/types";
import { describeError, getAssumptions } from "@/lib/api";
import { AssumptionModal } from "./AssumptionModal";
import {
  describe,
  groupKey,
  groupOf,
  isJudgment,
  isScalar,
  summarizeValue,
} from "./assumptionText";
import styles from "./Assumptions.module.css";

/** Response from the assumptions call, or the error it failed with. */
type Loaded = { rows?: AssumptionRow[]; error?: string };

export function AssumptionsView() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [query, setQuery] = useState("");
  const [onlyJudgment, setOnlyJudgment] = useState(false);
  /** Index into the filtered list of the card whose dialog is open, or null when closed. */
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    getAssumptions().then(
      (rows) => {
        if (live) setLoaded({ rows });
      },
      (err: unknown) => {
        if (live) setLoaded({ error: describeError(err) });
      },
    );
    return () => {
      live = false;
    };
  }, []);

  const rows = useMemo(() => loaded?.rows ?? [], [loaded]);
  const sourced = rows.filter((row) => !isJudgment(row)).length;

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (!onlyJudgment || isJudgment(row)) &&
        (needle === "" ||
          `${row.parameter} ${row.source ?? ""} ${row.rationale ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [rows, query, onlyJudgment]);

  // Cards are grouped by the first segment of the parameter, in the order the engine returns them.
  const sections = useMemo(() => {
    const byKey = new Map<string, AssumptionRow[]>();
    for (const row of shown) {
      const key = groupKey(row.parameter);
      byKey.set(key, [...(byKey.get(key) ?? []), row]);
    }
    return [...byKey].map(([key, members]) => ({ key, group: groupOf(key), rows: members }));
  }, [shown]);

  const activeRow = active !== null ? (shown[active] ?? null) : null;

  return (
    <section className="record" data-page="assumptions" data-ready={loaded ? "true" : "false"}>
      <div className="record-head">
        <div>
          <div className="kind">Configuration</div>
          <h1>Assumptions</h1>
        </div>
      </div>
      <p className={styles.sub}>
        Every business number the engine uses, from <span className={styles.mono}>config.yaml</span>.{" "}
        {sourced} of {rows.length} rows cite a source; the rest are marked as judgment. Select a card for its
        full details.
      </p>
      <div className="tools">
        <label className={styles.search}>
          Search
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. diesel, shelf life, credit"
          />
        </label>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={onlyJudgment}
            onChange={(e) => setOnlyJudgment(e.target.checked)}
          />
          Judgment only
        </label>
        <span className="spacer" />
        <span className="hint">{shown.length} shown</span>
      </div>
      {!loaded && <p className="empty">Loading assumptions…</p>}
      {loaded?.error && <p className="notice error">{loaded.error}</p>}
      {loaded?.rows && shown.length === 0 && <p className="empty">No assumptions match.</p>}

      {sections.map((section) => (
        <div key={section.key} className={styles.section}>
          <h2 className={styles.sectionHead}>
            <span className={styles.dot} style={{ background: section.group.color }} aria-hidden="true" />
            {section.group.label}
            <span className={styles.count}>{section.rows.length}</span>
            <span className={styles.blurb}>{section.group.blurb}</span>
          </h2>
          <div className={styles.grid}>
            {section.rows.map((row) => {
              const group = groupOf(section.key);
              return (
                <button
                  type="button"
                  key={row.parameter}
                  className={styles.card}
                  onClick={() => setActive(shown.indexOf(row))}
                >
                  <span className={styles.tile} style={{ background: group.color }} aria-hidden="true">
                    {group.short}
                  </span>
                  <span className={styles.body}>
                    <span className={styles.param}>{row.parameter}</span>
                    <span className={styles.desc}>{describe(row.parameter)}</span>
                    <span className={styles.meta}>
                      <b className={styles.value}>
                        {summarizeValue(row.value)}
                        {row.unit && isScalar(row.value) ? ` ${row.unit}` : ""}
                      </b>
                      {isJudgment(row) ? (
                        <span className="status tone-warn">Judgment</span>
                      ) : (
                        <span className={styles.src} title={row.source ?? undefined}>
                          {row.source}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <AssumptionModal
        row={activeRow}
        position={(active ?? 0) + 1}
        total={shown.length}
        onPrev={() => setActive((i) => (i !== null && i > 0 ? i - 1 : i))}
        onNext={() => setActive((i) => (i !== null && i < shown.length - 1 ? i + 1 : i))}
        onClose={() => setActive(null)}
      />
    </section>
  );
}
