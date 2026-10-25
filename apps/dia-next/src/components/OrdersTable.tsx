import { useState } from "react";
import type { OrderSummary } from "@dia/types";
import { CREDIT_FULL_PCT } from "@/lib/config";
import { formatNumber, formatPercent, formatRupees, formatSigned, orderStatus } from "@/lib/format";

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
  selectedDist: string | null;
  onSelect: (distId: string) => void;
};

function deltaClass(value: number): string {
  if (value > 0) return "delta-up";
  if (value < 0) return "delta-down";
  return "delta-0";
}

export function OrdersTable({ orders, selectedDist, onSelect }: Props) {
  const [filter, setFilter] = useState<FilterId>("all");
  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const visible = orders.filter(active.test);

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
        <span className="hint">Sorted by order value. Click an order to see its lines.</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
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
                <td colSpan={8} className="empty-cell">
                  No orders match this filter.
                </td>
              </tr>
            )}
            {visible.map((o) => {
              const status = orderStatus(o);
              const selected = o.dist_id === selectedDist;
              const full = o.credit_used_pct >= CREDIT_FULL_PCT;
              return (
                <tr key={o.dist_id} className={selected ? "sel" : undefined}>
                  <td className="city">
                    <button
                      type="button"
                      className="row-link"
                      aria-pressed={selected}
                      onClick={() => onSelect(o.dist_id)}
                    >
                      <b>{o.dist_city}</b>
                      <span>{o.dist_id}</span>
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
                        <i
                          className={full ? "full" : undefined}
                          style={{ width: `${Math.min(o.credit_used_pct, 100)}%` }}
                        />
                      </div>
                      <span className="pct">{formatPercent(o.credit_used_pct)}</span>
                    </div>
                  </td>
                  <td className={`num ${deltaClass(o.cases_since_draft)}`}>
                    {formatSigned(o.cases_since_draft)}
                  </td>
                  <td className="num">{o.proposal_version}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
