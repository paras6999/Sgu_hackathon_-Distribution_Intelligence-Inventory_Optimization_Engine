"use client";

import { useState } from "react";
import type { AtRisk } from "@dia/types";
import { formatDate, formatNumber, plural } from "@/lib/format";
import styles from "./StockWatch.module.css";

type Filter = "all" | "depot" | "distributor";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "depot", label: "Depots" },
  { id: "distributor", label: "Distributors" },
];

type Props = {
  /** Null while the list loads. */
  rows: AtRisk[] | null;
  error: string | null;
  /** Product and place currently charted below. Matching rows are highlighted. */
  selectedSku: string | null;
  selectedDist: string | null;
  onPick: (row: AtRisk) => void;
};

function daysLeft(days: number): string {
  return days <= 0 ? "Past expiry" : `${plural(days, "day")} left`;
}

/** Zero shows as 0. Other values keep one decimal. */
function oneDecimal(value: number): string {
  return value === 0 ? "0" : value.toFixed(1);
}

/**
 * The engine's action text includes the per-day sales figures in brackets. Those figures have their own
 * column, so the action keeps only the instruction: "Ship within 1 day", "Move to Kolkata or discount before …".
 */
export function actionOnly(text: string): string {
  const ship = /^Ship within (\d+) days?\b/.exec(text);
  if (ship) return `Ship within ${ship[1]} ${ship[1] === "1" ? "day" : "days"}`;
  return text.replace(/\s*\([^)]*\/day[^)]*\)/, "");
}

export function AtRiskBox({ rows, error, selectedSku, selectedDist, onPick }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const all = rows ?? [];
  const visible = filter === "all" ? all : all.filter((r) => r.holder_type === filter);
  const countOf = (f: Filter) => (f === "all" ? all.length : all.filter((r) => r.holder_type === f).length);

  return (
    <div className="box">
      <h2>Stock that may expire</h2>
      <p>Lots that will expire before they sell at the current pace. Click a row to chart it below.</p>

      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      {rows === null && !error && <p className="empty">Loading stock at risk…</p>}

      {rows !== null && (
        <>
          <div className={styles.chips}>
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`chip${filter === f.id ? " on" : ""}`}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label} {formatNumber(countOf(f.id))}
              </button>
            ))}
          </div>

          {all.length === 0 && <p className="empty">Nothing is at risk on this date.</p>}
          {all.length > 0 && visible.length === 0 && (
            <p className="empty">No stock of this kind is at risk on this date.</p>
          )}

          {visible.length > 0 && (
            <div className="table-wrap">
              <table className={styles.riskTable}>
                <thead>
                  <tr>
                    <th>Where</th>
                    <th>Product</th>
                    <th className={styles.expires}>Expires</th>
                    <th className="num">Cases</th>
                    <th className="num">Sells per day</th>
                    <th className="num">Days to sell</th>
                    <th className="num">Expected to expire</th>
                    <th>What to do</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((row, i) => {
                    const selected = row.sku_id === selectedSku && row.dist_id === selectedDist;
                    const isDepot = row.holder_type === "depot";
                    return (
                      <tr
                        key={`${row.holder_type}-${row.dist_id}-${row.sku_id}-${row.lot_id ?? row.expiry}-${i}`}
                        className={`${selected ? "sel " : ""}${styles.row}`}
                        onClick={() => onPick(row)}
                      >
                        <td>
                          <span className={styles.where}>{row.dist_city}</span>{" "}
                          <span className={`status ${isDepot ? "tone-muted" : "tone-warn"}`}>
                            {isDepot ? "Depot" : "Distributor"}
                          </span>
                        </td>
                        <td>{row.sku_name}</td>
                        <td className={styles.expires}>
                          <span className={styles.line}>{formatDate(row.expiry)}</span>
                          <span className={`${styles.sub} ${styles.line} ${row.days_left <= 0 ? styles.pastDue : ""}`}>
                            {daysLeft(row.days_left)}
                          </span>
                        </td>
                        <td className="num">{formatNumber(row.stock_cases)}</td>
                        <td className="num">{oneDecimal(row.daily_demand_cases)}</td>
                        <td className="num">{oneDecimal(row.expected_days_to_sell)}</td>
                        <td className="num">{oneDecimal(row.expected_expired_cases)}</td>
                        <td>{actionOnly(row.suggested_action)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="caption">
                Expected to expire = cases that would be left unsold before the expiry date.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
