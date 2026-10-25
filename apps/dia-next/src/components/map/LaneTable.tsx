import { formatNumber, formatRupees, reasonLabel } from "@/lib/format";
import { laneColour } from "@/lib/mapColors";
import type { LaneRow } from "./lanes";
import styles from "./map.module.css";

type Props = {
  rows: LaneRow[];
  selected: string | null;
  onSelect: (key: string) => void;
};

/** Lanes of the plan, largest first. A click selects the lane. */
export function LaneTable({ rows, selected, onSelect }: Props) {
  return (
    <div className={`table-wrap ${styles.tableScroll}`}>
      <table>
        <thead>
          <tr>
            <th>From</th>
            <th>To</th>
            <th className="num">Cases</th>
            <th>Main reason</th>
            <th className="num">Freight</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-cell">
                No lanes match this filter.
              </td>
            </tr>
          )}
          {rows.map((lane) => (
            <tr
              key={lane.key}
              className={`${styles.row}${lane.key === selected ? " sel" : ""}`}
              onClick={() => onSelect(lane.key)}
            >
              <td>{lane.fromName}</td>
              <td>{lane.toName}</td>
              <td className="num">{formatNumber(lane.cases)}</td>
              <td>
                {lane.reason ? (
                  <>
                    <i className={styles.swatch} style={{ background: laneColour(lane.reason) }} />
                    {reasonLabel(lane.reason)}
                  </>
                ) : (
                  <span className="muted">Not given</span>
                )}
              </td>
              <td className="num">{formatRupees(lane.freight)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
