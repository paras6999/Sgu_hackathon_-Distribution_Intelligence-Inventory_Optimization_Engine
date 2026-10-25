import type { Plan } from "@dia/types";
import { MODE_OPTIONS, type UiMode } from "@/lib/config";
import { formatDate, plural, planStatusLabel, tempLabel } from "@/lib/format";

type Props = {
  plan: Plan | null;
  orderCount: number | null;
  mode: UiMode;
  justUpdated: boolean;
  onModeChange: (mode: UiMode) => void;
  onApprove: () => void;
};

export function RecordHeader({
  plan,
  orderCount,
  mode,
  justUpdated,
  onModeChange,
  onApprove,
}: Props) {
  const sent = plan?.status === "PROPOSED" || plan?.status === "FINAL";
  const count = orderCount ?? 0;
  const approveLabel = sent
    ? `Sent to ${plural(count, "order")}`
    : orderCount === null
      ? "Approve and send orders"
      : `Approve and send ${plural(count, "order")}`;

  return (
    <div className="record-head">
      <div>
        <div className="kind">
          {plan ? `Planning cycle · ${tempLabel(plan.temp_class)}` : "Planning cycle"}
        </div>
        <h1>
          {plan ? `Week of ${formatDate(plan.as_of)}` : "Loading the plan"}
          {plan && <span className="pill">Version {plan.version}</span>}
          {plan && <span className="pill">{planStatusLabel(plan.status)}</span>}
          {justUpdated && <span className="flash">Updated just now</span>}
        </h1>
      </div>
      <span className="spacer" />
      <div className="seg" role="group" aria-label="How the assistant acts">
        {MODE_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            className={`seg-btn${mode === option.id ? " on" : ""}`}
            aria-pressed={mode === option.id}
            onClick={() => onModeChange(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn primary"
        disabled={!plan || sent || !orderCount}
        onClick={onApprove}
      >
        {approveLabel}
      </button>
    </div>
  );
}
