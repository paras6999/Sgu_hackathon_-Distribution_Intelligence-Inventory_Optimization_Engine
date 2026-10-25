"use client";

import { useState } from "react";
import type { OrderSummary, PlanLine, ResponseAction } from "@dia/types";
import { depotName, formatDate, formatNumber, lineStatusLabel, reasonLabel } from "@/lib/format";

export type LineDecision = { line_id: string; action: ResponseAction; qty?: number | null };

type Props = {
  order: OrderSummary;
  /** Shipment lines of this order, from the latest plan version. */
  lines: PlanLine[];
  /** True once the plan is sent. Before that, distributors have no order to answer. */
  canAct: boolean;
  busy: boolean;
  onApply: (decisions: LineDecision[]) => void;
};

const ACTION_LABEL: Record<ResponseAction, string> = {
  accept: "Accept",
  trim: "Trim",
  reject: "Reject",
};

/** The open order: its lines, and the status each line should have. Shown inline under the order row. */
export function OrderLines({ order, lines, canAct, busy, onApply }: Props) {
  const [choice, setChoice] = useState<Record<string, LineDecision>>({});
  const [problem, setProblem] = useState<string | null>(null);

  const decisionOf = (line: PlanLine): LineDecision =>
    choice[line.line_id] ?? { line_id: line.line_id, action: "accept" };

  const update = (line: PlanLine, patch: Partial<LineDecision>) => {
    setProblem(null);
    setChoice((prev) => ({ ...prev, [line.line_id]: { ...decisionOf(line), ...patch } }));
  };

  const applyAll = (action: ResponseAction) => {
    setProblem(null);
    onApply(lines.map((l) => ({ line_id: l.line_id, action })));
  };

  const saveChoices = () => {
    const decisions = lines.map((l) => decisionOf(l));
    for (const d of decisions) {
      const line = lines.find((l) => l.line_id === d.line_id);
      if (d.action === "trim" && line && (d.qty === undefined || d.qty === null || d.qty < 0 || d.qty >= line.cases)) {
        setProblem(`Trim ${line.sku_name} to fewer than ${line.cases} cases and zero or more.`);
        return;
      }
    }
    onApply(decisions);
  };

  const disabled = !canAct || busy;

  return (
    <div className="order-open">
      <div className="order-open-head">
        <div>
          <b>{order.dist_city}</b>
          <span className="muted"> · {formatNumber(order.lines)} lines · {formatNumber(order.cases)} cases</span>
        </div>
        <div className="order-open-actions">
          <button type="button" className="btn small" disabled={disabled} onClick={() => applyAll("accept")}>
            Accept all
          </button>
          <button type="button" className="btn small danger" disabled={disabled} onClick={() => applyAll("reject")}>
            Reject order
          </button>
          <button type="button" className="btn small primary" disabled={disabled} onClick={saveChoices}>
            Save line choices
          </button>
        </div>
      </div>
      {!canAct && (
        <p className="notice">Approve and send the plan first. Orders can be answered once they are sent.</p>
      )}
      {problem && <p className="notice error">{problem}</p>}
      <div className="table-wrap scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>From</th>
              <th className="num">Cases</th>
              <th>Expiry</th>
              <th>Choice</th>
              <th className="num">Trim to</th>
              <th>Line status</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-cell">No shipment lines for this order.</td>
              </tr>
            )}
            {lines.map((line) => {
              const d = decisionOf(line);
              return (
                <tr key={line.line_id}>
                  <td>{line.sku_name}</td>
                  <td>{depotName(line.from_id)}</td>
                  <td className="num">{formatNumber(line.cases)}</td>
                  <td>{formatDate(line.expiry)}</td>
                  <td>
                    <select
                      aria-label={`Choice for ${line.sku_name}`}
                      value={d.action}
                      disabled={disabled}
                      onChange={(e) => update(line, { action: e.target.value as ResponseAction, qty: null })}
                    >
                      {(Object.keys(ACTION_LABEL) as ResponseAction[]).map((a) => (
                        <option key={a} value={a}>{ACTION_LABEL[a]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="num">
                    <input
                      type="number"
                      min={0}
                      max={Math.max(line.cases - 1, 0)}
                      aria-label={`Trim ${line.sku_name} to`}
                      className="qty"
                      value={d.action === "trim" ? (d.qty ?? "") : ""}
                      placeholder={d.action === "trim" ? "cases" : "—"}
                      disabled={disabled || d.action !== "trim"}
                      onChange={(e) => update(line, { qty: e.target.value === "" ? null : Number(e.target.value) })}
                    />
                  </td>
                  <td>{lineStatusLabel(line.status)}</td>
                  <td>{line.reasons?.map((r) => reasonLabel(r.code)).join(", ") || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
