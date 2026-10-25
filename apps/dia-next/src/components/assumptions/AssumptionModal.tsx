import { useEffect, useRef } from "react";
import type { AssumptionRow } from "@dia/types";
import {
  describe,
  groupKey,
  groupOf,
  isJudgment,
  summarizeValue,
} from "./assumptionText";
import styles from "./Assumptions.module.css";

type Props = {
  /** The row to show, or null when the dialog is closed. */
  row: AssumptionRow | null;
  /** Position of the row in the filtered list, shown as "3 of 49". */
  position: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
};

/** Details for one assumption. Uses the native dialog, so Escape and focus handling come from the browser. */
export function AssumptionModal({ row, position, total, onPrev, onNext, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (row && !dialog.open) dialog.showModal();
    if (!row && dialog.open) dialog.close();
  }, [row]);

  const group = row ? groupOf(groupKey(row.parameter)) : null;
  const judgment = row ? isJudgment(row) : false;

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="assumption-title"
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog itself, not on its content.
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      {row && group && (
        <div className={styles.modal}>
          <header className={styles.modalHead}>
            <span className={styles.tileLg} style={{ background: group.color }} aria-hidden="true">
              {group.short}
            </span>
            <div className={styles.modalTitle}>
              <span className="kind">{group.label}</span>
              <h2 id="assumption-title" className={styles.mono}>
                {row.parameter}
              </h2>
            </div>
            <button
              type="button"
              className={styles.close}
              onClick={() => ref.current?.close()}
              aria-label="Close"
            >
              ×
            </button>
          </header>

          <p className={styles.modalDesc}>{describe(row.parameter)}</p>

          <dl className={styles.facts}>
            <div>
              <dt>Value</dt>
              <dd className={styles.factValue}>{summarizeValue(row.value)}</dd>
            </div>
            <div>
              <dt>Unit</dt>
              <dd>{row.unit ?? "None"}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>
                {judgment ? (
                  <>
                    <span className="status tone-warn">Judgment</span>
                    <span className={styles.note}>Set by the team, not taken from a published source.</span>
                  </>
                ) : (
                  row.source
                )}
              </dd>
            </div>
          </dl>

          {row.rationale && (
            <div>
              <p className={styles.factLabel}>Why this value</p>
              <p className={styles.rationale}>{row.rationale}</p>
            </div>
          )}

          {row.value !== null && typeof row.value === "object" && (
            <div>
              <p className={styles.factLabel}>Full value</p>
              <pre className={styles.raw}>{JSON.stringify(row.value, null, 2)}</pre>
            </div>
          )}

          <div className={styles.modalFoot}>
            <button type="button" className="btn small" onClick={onPrev} disabled={position <= 1}>
              Previous
            </button>
            <button type="button" className="btn small" onClick={onNext} disabled={position >= total}>
              Next
            </button>
            <span className="hint">
              {position} of {total}
            </span>
            <span className="spacer" />
            <button type="button" className="btn small primary" onClick={() => ref.current?.close()}>
              Close
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
