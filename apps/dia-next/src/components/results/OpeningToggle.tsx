import type { OpeningState } from "@dia/types";
import { OPENING_NAME } from "@/lib/names";

const OPTIONS: OpeningState[] = ["neutral", "imbalanced"];

/** Switches the evaluation between the neutral and the imbalanced starting stock. */
export function OpeningToggle({
  value,
  onChange,
}: {
  value: OpeningState;
  onChange: (value: OpeningState) => void;
}) {
  return (
    <div className="seg" role="group" aria-label="Starting stock">
      {OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          className={`seg-btn${value === option ? " on" : ""}`}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {OPENING_NAME[option]}
        </button>
      ))}
    </div>
  );
}
