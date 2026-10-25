import type { OrderSummary, PlanLine } from "@dia/types";
import { formatDate, formatNumber, orderStatus, plural, depotName, lineStatusLabel, reasonLabel } from "@/lib/format";

type Props = {
  order: OrderSummary | null;
  /** The plan's shipment lines that go to this order's distributor. */
  lines: PlanLine[];
};

function sinceDraftSentence(order: OrderSummary): string {
  const now = `Now ${plural(order.cases, "case")} in ${plural(order.lines, "line")}.`;
  if (order.cases_since_draft === 0) return `No change since the draft. ${now}`;
  const direction = order.cases_since_draft > 0 ? "Up" : "Down";
  return `${direction} ${formatNumber(Math.abs(order.cases_since_draft))} cases since the draft. ${now}`;
}

export function OrderDetail({ order, lines }: Props) {
  if (!order) {
    return (
      <div className="box">
        <h2>Selected order</h2>
        <p>No orders in this plan yet.</p>
      </div>
    );
  }

  const status = orderStatus(order);
  return (
    <div className="box">
      <h2>Selected order: {order.dist_city}</h2>
      <p>{sinceDraftSentence(order)}</p>
      <p>
        Status: <b>{status.label}</b>. Version {order.proposal_version}.
      </p>
      <div className="scroll table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>From</th>
              <th className="num">Cases</th>
              <th>Expiry</th>
              <th>Line status</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-cell">
                  No shipment lines for this order.
                </td>
              </tr>
            )}
            {lines.map((line) => (
              <tr key={line.line_id}>
                <td>{line.sku_name}</td>
                <td>{depotName(line.from_id)}</td>
                <td className="num">{formatNumber(line.cases)}</td>
                <td>{formatDate(line.expiry)}</td>
                <td>{lineStatusLabel(line.status)}</td>
                <td>{line.reasons?.map((r) => reasonLabel(r.code)).join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
