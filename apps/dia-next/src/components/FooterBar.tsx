import type { Plan } from "@dia/types";
import { formatDateTime, formatNumber } from "@/lib/format";

export function FooterBar({ plan, orderCount }: { plan: Plan | null; orderCount: number | null }) {
  return (
    <footer className="foot">
      <span>
        <b>Orders</b> {orderCount === null ? "—" : formatNumber(orderCount)}
      </span>
      <span className="spacer" />
      {plan && (
        <span>
          Version {plan.version} created {formatDateTime(plan.created_at)}
        </span>
      )}
    </footer>
  );
}
