import type { OrderSummary, OrdersView } from "@dia/types";
import { formatNumber, plural } from "@/lib/format";

export type FreedSummary = {
  /** Cases taken off orders by trims since the draft. */
  freed: number;
  /** Freed cases that reappear on other orders. */
  moved: number;
  /** Freed cases that are not on any order, so they stay at the depots. */
  rest: number;
  /** Total cases added to orders that grew since the draft. */
  gained: number;
  gainers: OrderSummary[];
};

/** Works out where the freed cases went, from each order's change since the draft. */
export function summarizeFreed(orders: OrderSummary[]): FreedSummary {
  const freed = -orders
    .filter((o) => o.cases_since_draft < 0)
    .reduce((sum, o) => sum + o.cases_since_draft, 0);
  const gainers = orders
    .filter((o) => o.cases_since_draft > 0)
    .sort((a, b) => b.cases_since_draft - a.cases_since_draft);
  const gained = gainers.reduce((sum, o) => sum + o.cases_since_draft, 0);
  const moved = Math.min(freed, gained);
  return { freed, moved, rest: freed - moved, gained, gainers };
}

export function FreedCases({
  orders,
  totals,
}: {
  orders: OrderSummary[];
  totals: OrdersView["totals"];
}) {
  const s = summarizeFreed(orders);
  const nothingMoved = s.freed === 0 && s.gained === 0;
  const shipsSentence =
    totals.cases === totals.draft_cases
      ? `The plan still ships ${formatNumber(totals.cases)} cases, the same as the draft.`
      : `The plan ships ${formatNumber(totals.cases)} cases, not ${formatNumber(totals.draft_cases)}.`;

  return (
    <div className="box">
      <h2>{s.freed > 0 ? `What the ${formatNumber(s.freed)} freed cases did` : "What the freed cases did"}</h2>
      {nothingMoved && <p>No cases have moved since the draft.</p>}
      {s.freed > 0 && <p>{formatNumber(s.freed)} cases were freed by trims.</p>}
      {s.moved > 0 && (
        <p>
          <b>{formatNumber(s.moved)} cases were reassigned:</b>{" "}
          {s.gainers.map((o) => `${o.dist_city} +${formatNumber(o.cases_since_draft)}`).join(", ")}.
        </p>
      )}
      {s.gained > s.freed && (
        <p>Orders gained {formatNumber(s.gained - s.freed)} more cases than the trims freed.</p>
      )}
      {s.rest > 0 && (
        <p>
          <b>{plural(s.rest, "case")} stay at the depots.</b>
        </p>
      )}
      {!nothingMoved && <p>{shipsSentence}</p>}
    </div>
  );
}
