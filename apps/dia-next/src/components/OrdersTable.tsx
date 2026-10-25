"use client";

import { useState } from "react";
import type { OrderSummary, PlanLine, ResponseAction } from "@dia/types";
import { CREDIT_FULL_PCT } from "@/lib/config";
import { formatNumber, formatPercent, formatRupees, formatSigned, orderStatus } from "@/lib/format";
import { OrderLines, type LineDecision } from "./OrderLines";

type FilterId = "all" | "waiting" | "changed" | "credit";

const FILTERS: { id: FilterId; label: string; test: (o: OrderSummary) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "waiting", label: "Waiting for reply", test: (o) => !o.replied },
  { id: "changed", label: "Changed", test: (o) => o.cases_since_draft !== 0 },
  { id: "credit", label: "Credit full", test: (o) => o.credit_used_pct >= CREDIT_FULL_PCT },
];

type Props = {
  /** Orders already sorted by value, highest first. */
  orders: OrderSummary[];
  lines: PlanLine[];
  canAct: boolean;
  busy: boolean;
  /** Apply line decisions to one order. */
  onApplyOrder: (order: OrderSummary, decisions: LineDecision[]) => void;
  /** Accept or reject every line of each checked order. */
  onBulk: (distIds: string[], action: ResponseAction) => void;
};

function deltaClass(value: number): string {
  if (value > 0) return "delta-up";
  if (value < 0) return "delta-down";
  return "delta-0";
}

export function OrdersTable({ orders, lines, canAct, busy, onApplyOrder, onBulk }: Props) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [openDist, setOpenDist] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const visible = orders.filter(active.test);

  const toggleCheck = (distId: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(distId)) next.delete(distId);
      else next.add(distId);
      return next;
    });

  const bulk = (action: ResponseAction) => {
    onBulk([...checked], action);
    setChecked(new Set());
  };

  return (
    <>
      <div className="tools">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`chip${filter === f.id ? " on" : ""}`}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.label} {orders.filter(f.test).length}
          </button>
        ))}
        <span className="spacer" />
        {checked.size > 0 ? (
          <span className="bulk">
            <span className="muted">{checked.size} selected</span>
            <button type="button" className="btn small" disabled={!canAct || busy} onClick={() => bulk("accept")}>
              Accept all
            </button>
            <button type="button" className="btn small danger" disabled={!canAct || busy} onClick={() => bulk("reject")}>
              Reject all
            </button>
            <button type="button" className="btn small" onClick={() => setChecked(new Set())}>
              Clear
            </button>
          </span>
        ) : (
          <span className="hint">Click an order to open its lines. Tick orders to act on several at once.</span>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="check-col" aria-label="Select" />
              <th>Order</th>
              <th>Status</th>
              <th className="num">Lines</th>
              <th className="num">Cases</th>
              <th className="num">Value</th>
              <th>Credit used</th>
              <th className="num">Since draft</th>
              <th className="num">Version</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="empty-cell">No orders match this filter.</td>
              </tr>
            )}
            {visible.map((o) => {
              const status = orderStatus(o);
              const open = o.dist_id === openDist;
              const full = o.credit_used_pct >= CREDIT_FULL_PCT;
              return (
                <OrderRow key={o.dist_id}>
                  <tr className={open ? "sel" : undefined}>
                    <td className="check-col">
                      <input
                        type="checkbox"
                        aria-label={`Select ${o.dist_city}`}
                        checked={checked.has(o.dist_id)}
                        onChange={() => toggleCheck(o.dist_id)}
                      />
                    </td>
                    <td className="city">
                      <button
                        type="button"
                        className="row-link"
                        aria-expanded={open}
                        onClick={() => setOpenDist(open ? null : o.dist_id)}
                      >
                        <b>{o.dist_city}</b>
                        <span>{o.dist_id} · {open ? "Close" : "Open"}</span>
                      </button>
                    </td>
                    <td>
                      <span className={`status tone-${status.tone}`}>{status.label}</span>
                    </td>
                    <td className="num">{formatNumber(o.lines)}</td>
                    <td className="num">{formatNumber(o.cases)}</td>
                    <td className="num">{formatRupees(o.value_inr)}</td>
                    <td>
                      <div className="credit">
                        <div className="bar">
                          <i className={full ? "full" : undefined} style={{ width: `${Math.min(o.credit_used_pct, 100)}%` }} />
                        </div>
                        <span className="pct">{formatPercent(o.credit_used_pct)}</span>
                      </div>
                    </td>
                    <td className={`num ${deltaClass(o.cases_since_draft)}`}>{formatSigned(o.cases_since_draft)}</td>
                    <td className="num">{o.proposal_version}</td>
                  </tr>
                  {open && (
                    <tr className="open-row">
                      <td colSpan={9}>
                        <OrderLines
                          order={o}
                          lines={lines.filter((l) => l.to_id === o.dist_id)}
                          canAct={canAct}
                          busy={busy}
                          onApply={(decisions) => onApplyOrder(o, decisions)}
                        />
                      </td>
                    </tr>
                  )}
                </OrderRow>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Wraps a row and its optional open panel so React keys stay on the order. */
function OrderRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
