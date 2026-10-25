/**
 * Guide: what each term and variable in Vitaran means, with the value the engine is using right now.
 * Values come from the assumptions table (GET /v1/assumptions), so the page cannot drift from the config.
 */
import type { AssumptionRow } from "@dia/types";
import { api } from "../api";
import { ErrorText, PageHeader, useLoad } from "../components/ui";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const x = (v: number) => `×${v}`;

type Entry = { term: string; means: string; value: (get: (p: string) => unknown) => string };

const ENTRIES: Array<{ group: string; intro: string; items: Entry[] }> = [
  {
    group: "The two rules we compare against",
    intro: "The engine is judged against the better of these two simple planning rules, on the same simulated demand, delays and promotions.",
    items: [
      {
        term: "Baseline A · fair share",
        means: "Each depot splits its stock of a product between the distributors in its region in proportion to their sales over the last 4 weeks, up to a target of 14 days of cover. It sends the oldest stock first, which is not always the stock that will expire first.",
        value: () => "Target cover 14 days",
      },
      {
        term: "Baseline B · nearest depot, reorder level",
        means: "A distributor reorders up to a level whenever its stock falls below a reorder point, aiming for a 95% chance of not running out. Orders are served from the nearest depot with stock, first come first served. Loads under 70% of a truck are sent part-loaded.",
        value: () => "Service level 95%",
      },
      {
        term: "Engine (Vitaran)",
        means: "One optimiser decides every lot, depot, distributor and truck together, trading off freight, lost sales, holding and expiry, and prices each choice in rupees.",
        value: () => "One solve per cycle",
      },
    ],
  },
  {
    group: "Demand and the calendar",
    intro: "What makes demand rise and fall, as the forecast learns it from two years of sales and real weather.",
    items: [
      {
        term: "Festival uplift",
        means: "Demand rises before a festival, by a different amount for each product category and region. Diwali, for example, lifts snacks sharply. The forecast applies the uplift in the days before the festival (the run-up).",
        value: (get) => {
          const f = (get("calendar.festivals") as Array<{ name: string; uplift: Record<string, number>; days_before: number }> | undefined) ?? [];
          const diwali = f.find((x) => x.name === "Diwali");
          return diwali ? `Diwali: ${Object.entries(diwali.uplift).map(([k, v]) => `${k} ${x(v)}`).join(", ")}; ${diwali.days_before} days before` : "see calendar";
        },
      },
      {
        term: "Weather effect",
        means: "Heat and rain change demand by category: beverages sell more in heat, dairy and snacks fall when it rains. Real daily temperature and rainfall for each city are used for past demand and for the forecast.",
        value: (get) => {
          const c = (get("categories") as Record<string, { heat_beta: number; rain_cut: number }> | undefined) ?? {};
          const bev = c.beverages;
          return bev ? `Beverages: +${(bev.heat_beta * 100).toFixed(0)}% per °C above normal; rain cuts ${pct(bev.rain_cut)}` : "see categories";
        },
      },
      {
        term: "Forecast error (WAPE)",
        means: "The average size of the forecast miss, as a share of actual sales, over 12 past weeks. Lower is better. A naive 'same as last year' forecast is shown beside it for comparison.",
        value: () => "14.6% vs 29.3% naive (on the test window)",
      },
    ],
  },
  {
    group: "Stock, shelf life and space",
    intro: "The rules that decide what can be sent, and when stock is too old to sell.",
    items: [
      {
        term: "Shelf-life floor (60%)",
        means: "A lot must still have at least this share of its shelf life left when it arrives at the distributor. Below that, the distributor will not take it, so the optimiser does not send it.",
        value: (get) => {
          const m = (get("planning.mrsl_fraction") as Record<string, number> | undefined) ?? {};
          return m.GT !== undefined ? pct(m.GT) : "see planning";
        },
      },
      {
        term: "Expiry write-off",
        means: "Stock that expires is written off. The depot bears the cost of stock it still holds near expiry; the optimiser prices that cost on every lot, so it ships ageing stock first.",
        value: () => "Priced per lot",
      },
      {
        term: "Credit limit",
        means: "The most a distributor can owe at any time, set as a number of weeks of its purchases. Orders above the credit left are cut. This is what holds back fill rate.",
        value: (get) => `${get("supply.distributor_credit_weeks") ?? "?"} weeks of purchases`,
      },
      {
        term: "Godown storage",
        means: "The space a distributor has, set as weeks of its volume. The optimiser cannot send more than the free space in a godown.",
        value: (get) => `${get("supply.distributor_storage_weeks") ?? "?"} weeks of volume`,
      },
      {
        term: "Depot space",
        means: "The space at each depot store (ambient store and cold room), in weeks of its region's volume. Shown in the warehouse app and on the Warehouses screen. Depots only ship out, so it does not limit a plan.",
        value: (get) => {
          const d = get("supply.depot_storage_weeks") as { ambient: number; chilled: number } | undefined;
          return d ? `Ambient ${d.ambient} wk, chilled ${d.chilled} wk` : "see supply";
        },
      },
      {
        term: "Plant deliveries",
        means: "How often the factories deliver to the depots: ambient goods weekly, chilled goods every 2 days. Each planning day ships what arrived.",
        value: (get) => {
          const r = get("supply.receipt_every_days") as Record<string, number> | undefined;
          return r ? `Ambient every ${r.ambient} days, chilled every ${r.chilled} days` : "see supply";
        },
      },
      {
        term: "Cover (days of stock)",
        means: "How many days of expected sales a distributor holds after a delivery. Cover extremes count days with no stock where demand exists, or far too much stock.",
        value: () => "Target from the newsvendor rule",
      },
    ],
  },
  {
    group: "Cost, trade-offs and results",
    intro: "How the engine values each decision, and what the results mean.",
    items: [
      {
        term: "Stockout penalty",
        means: "The cost of one lost sale, as a multiple of the margin lost. A higher penalty makes the engine ship more and hold more stock, at more freight and expiry.",
        value: (get) => `${get("costs.stockout_penalty_x_margin") ?? "?"} × margin`,
      },
      {
        term: "Cost to serve",
        means: "Everything the network spends to get stock to customers: freight, lost margin, holding and expiry write-offs.",
        value: () => "Lower is better",
      },
      {
        term: "Fill rate",
        means: "The share of demand that is met from stock. The engine is currently 0.4 to 0.8 points below the better rule, because of credit limits. The Results screen shows the trade-off.",
        value: () => "Higher is better",
      },
      {
        term: "Wastage",
        means: "The value of stock that expires before it is sold, at depots and at distributors.",
        value: () => "Lower is better",
      },
      {
        term: "Diesel price",
        means: "The fuel price used for truck costs, so the what-if can test a price change.",
        value: (get) => {
          const c = get("costs.diesel_inr_per_l");
          return c !== undefined ? `₹${c} per litre` : "see costs";
        },
      },
      {
        term: "Judgment vs sourced",
        means: "Each assumption is marked as a sourced figure or as a judgment we made. The Assumptions screen lists all of them with their reasons.",
        value: () => "See Assumptions",
      },
    ],
  },
];

export function GuidePage() {
  const rows = useLoad<AssumptionRow[]>(api.assumptions, []);
  const get = (name: string) => rows.data?.find((r) => r.parameter === name)?.value;
  return (
    <section>
      <PageHeader
        title="Guide"
        sub="What each term and variable means in Vitaran, and the value the engine is using right now. Values are read from the assumptions table, so this page always matches the model."
      />
      <ErrorText error={rows.error} />
      {ENTRIES.map((g) => (
        <div key={g.group} style={{ marginTop: 18 }}>
          <h2 style={{ margin: "0 0 4px" }}>{g.group}</h2>
          <p className="muted" style={{ marginBottom: 10 }}>{g.intro}</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th style={{ width: "22%" }}>Term</th><th>What it means</th><th style={{ width: "24%" }}>Value now</th></tr></thead>
              <tbody>
                {g.items.map((e) => (
                  <tr key={e.term}>
                    <td><b>{e.term}</b></td>
                    <td style={{ lineHeight: 1.5 }}>{e.means}</td>
                    <td className="mono" style={{ fontSize: 13 }}>{rows.data ? e.value(get) : "…"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
