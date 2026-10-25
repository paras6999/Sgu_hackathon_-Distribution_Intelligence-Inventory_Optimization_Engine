import { useState } from "react";
import type { LearnedEffects } from "@dia/types";
import { SeasonChart } from "./SeasonChart";
import styles from "./Demand.module.css";

/** "ready_to_eat" becomes "Ready to eat". */
function titleCase(name: string): string {
  const spaced = name.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Bar length as a percentage of the largest learned uplift. Tiny values still show as a 2% sliver. */
function upliftWidth(learned: number, largest: number): number {
  if (largest <= 0) return 2;
  return Math.max(2, (learned / largest) * 100);
}

/** What the forecaster learned from the history: festival uplifts, monthly seasonality, and weather. */
export function LearnedPanel({ effects }: { effects: LearnedEffects }) {
  const categories = Object.keys(effects.seasonality);
  const [picked, setPicked] = useState("");
  const category = categories.includes(picked) ? picked : (categories[0] ?? "");

  const rows = effects.festivals.flatMap((f) =>
    Object.entries(f.learned).map(([group, learned]) => {
      const configured: number | undefined = f.configured[group];
      return { festival: f.name, group, learned, configured };
    }),
  );
  const gaps = rows.flatMap((r) => (r.configured === undefined ? [] : [Math.abs(r.learned - r.configured)]));
  const meanGap = gaps.length > 0 ? gaps.reduce((sum, g) => sum + g, 0) / gaps.length : null;
  const maxLearned = Math.max(...rows.map((r) => r.learned), 0);

  return (
    <div className="box">
      <h2>What the forecaster learned</h2>
      <p>
        Fitted on the history before the test window and used in every plan. The configured values are the ones the
        simulator was built with, so this is a recovery check.
      </p>

      <div className={styles.subhead}>
        <h3>Festival uplift</h3>
        {meanGap !== null && (
          <span className="status tone-muted">Mean gap to configured ×{meanGap.toFixed(2)}</span>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Festival</th>
              <th>Product group</th>
              <th className="num">Learned</th>
              <th className="num">Configured</th>
              <th>Learned uplift</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.festival}-${r.group}`}>
                <td>{r.festival}</td>
                <td>{titleCase(r.group)}</td>
                <td className="num">×{r.learned.toFixed(2)}</td>
                <td className="num">{r.configured === undefined ? "–" : `×${r.configured.toFixed(2)}`}</td>
                <td className={styles.barCell}>
                  <div className={styles.upliftTrack}>
                    <div className={styles.upliftFill} style={{ width: `${upliftWidth(r.learned, maxLearned)}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.twoCol}>
        <div>
          <div className={styles.subhead}>
            <h3>Seasonality by month</h3>
            <select aria-label="Product group" value={category} onChange={(e) => setPicked(e.target.value)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {titleCase(c)}
                </option>
              ))}
            </select>
          </div>
          <SeasonChart
            learned={effects.seasonality[category] ?? []}
            configured={effects.seasonality_configured[category] ?? []}
          />
          <p className="caption">
            Solid line: learned from the history. Dashed line: the value the simulator was built with.
          </p>
        </div>

        <div>
          <div className={styles.subhead}>
            <h3>Weather sensitivity</h3>
          </div>
          <div className={`table-wrap ${styles.weatherWrap}`}>
            <table className={styles.weatherTable}>
              <thead>
                <tr>
                  <th>Product group</th>
                  <th className="num">Heat, learned</th>
                  <th className="num">Heat, configured</th>
                  <th className="num">Rain cut, learned</th>
                  <th className="num">Rain cut, configured</th>
                </tr>
              </thead>
              <tbody>
                {effects.weather.map((w) => (
                  <tr key={w.category}>
                    <td>{titleCase(w.category)}</td>
                    <td className="num">{w.heat_pct_per_degc_learned.toFixed(1)}%</td>
                    <td className="num">{w.heat_pct_per_degc_configured.toFixed(1)}%</td>
                    <td className="num">{w.rain_cut_pct_learned.toFixed(0)}%</td>
                    <td className="num">{w.rain_cut_pct_configured.toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="caption">
            Heat is the change in demand per °C above 32 °C. Rain cut is the drop on heavy-rain days. The heat effect is
            mostly absorbed by the monthly curve, so the learned heat value stays low.
          </p>
        </div>
      </div>
    </div>
  );
}
