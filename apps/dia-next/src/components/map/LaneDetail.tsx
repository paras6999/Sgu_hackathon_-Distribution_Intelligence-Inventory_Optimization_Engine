import Link from "next/link";
import { formatNumber, formatRupees, reasonLabel } from "@/lib/format";
import type { LaneRow } from "./lanes";
import styles from "./map.module.css";

/** The selected lane: its products and cases, and a link to the distributor's order. */
export function LaneDetail({ lane }: { lane: LaneRow | null }) {
  if (!lane) {
    return (
      <div className="box">
        <h2>No lane selected</h2>
        <p>Click a lane on the map or a row in the table to see what it carries.</p>
      </div>
    );
  }

  return (
    <div className="box">
      <h2>
        {lane.fromName} to {lane.toName}
      </h2>
      <p>
        <b>{formatNumber(lane.cases)} cases</b> · freight {formatRupees(lane.freight)}
      </p>
      {lane.reason && <p>Main reason: {reasonLabel(lane.reason)}</p>}
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th className="num">Cases</th>
            </tr>
          </thead>
          <tbody>
            {lane.products.map((product) => (
              <tr key={product.name}>
                <td>{product.name}</td>
                <td className="num">{formatNumber(product.cases)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.boxAction}>
        <Link className="btn small" href={`/?order=${encodeURIComponent(lane.to)}`}>
          Open this order
        </Link>
      </div>
    </div>
  );
}
