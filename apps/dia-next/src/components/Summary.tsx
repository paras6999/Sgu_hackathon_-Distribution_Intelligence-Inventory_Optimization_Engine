import type { OrdersView } from "@dia/types";
import { CREDIT_FULL_PCT } from "@/lib/config";
import { formatNumber, formatPercent, formatRupees, plural } from "@/lib/format";

type CellProps = { label: string; value: string; note?: string; warn?: boolean };

function Cell({ label, value, note, warn }: CellProps) {
  return (
    <div className={warn ? "warn" : undefined}>
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {note && <div className="n">{note}</div>}
    </div>
  );
}

export function Summary({ orders }: { orders: OrdersView | null }) {
  const totals = orders?.totals;
  const fullCount = orders?.orders.filter((o) => o.credit_used_pct >= CREDIT_FULL_PCT).length ?? 0;

  if (!orders || !totals) {
    return (
      <div className="strip">
        <Cell label="Orders" value="—" note="Not available yet" />
        <Cell label="Replied" value="—" />
        <Cell label="Lines" value="—" />
        <Cell label="Cases" value="—" />
        <Cell label="Order value" value="—" />
        <Cell label="Credit used" value="—" />
      </div>
    );
  }

  return (
    <div className="strip">
      <Cell label="Orders" value={formatNumber(totals.orders)} note="one per distributor" />
      <Cell
        label="Replied"
        value={`${totals.replied} of ${totals.orders}`}
        note={`${totals.orders - totals.replied} waiting`}
      />
      <Cell label="Lines" value={formatNumber(totals.lines)} note={`draft had ${formatNumber(totals.draft_lines)}`} />
      <Cell label="Cases" value={formatNumber(totals.cases)} note={`draft had ${formatNumber(totals.draft_cases)}`} />
      <Cell
        label="Order value"
        value={formatRupees(totals.value_inr)}
        note={`Credit available ${formatRupees(totals.credit_available_inr)}`}
      />
      <Cell
        label="Credit used"
        value={formatPercent(totals.credit_used_pct)}
        note={`${plural(fullCount, "order")} at ${CREDIT_FULL_PCT}% or more`}
        warn={totals.credit_used_pct >= CREDIT_FULL_PCT}
      />
    </div>
  );
}
