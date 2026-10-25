import type { AssumptionRow } from "@dia/types";

/** One card group on the assumptions page. The key is the first segment of the parameter path. */
export type Group = { label: string; short: string; color: string; blurb: string };

const UNKNOWN_GROUP: Omit<Group, "label"> = { short: "··", color: "#5c5b59", blurb: "" };

export const GROUPS: Record<string, Group> = {
  network: { label: "Network", short: "NW", color: "#0176d3", blurb: "How depots, distributors and trucks connect." },
  catalogue: { label: "Catalogue", short: "CT", color: "#2e844a", blurb: "The products, depots and distributors in the model." },
  categories: { label: "Product groups", short: "PG", color: "#5b6bc0", blurb: "Settings that differ by product group." },
  demand: { label: "Demand", short: "DM", color: "#9050e9", blurb: "How much customers buy and how that demand moves." },
  calendar: { label: "Festival calendar", short: "FE", color: "#c2185b", blurb: "Festival dates and the extra demand they bring." },
  supply: { label: "Supply", short: "SU", color: "#b85c00", blurb: "How stock is made, received and held at each site." },
  planning: { label: "Planning rules", short: "PL", color: "#00838f", blurb: "How the engine decides what to ship and when." },
  forecast: { label: "Forecast", short: "FC", color: "#6d4c41", blurb: "How the demand forecast is refreshed." },
  costs: { label: "Costs", short: "CO", color: "#ba0517", blurb: "Freight, fuel, holding and stock-out costs." },
  carbon: { label: "Carbon", short: "CB", color: "#558b2f", blurb: "Emissions from trucks and any carbon price." },
  simulation: { label: "Simulation", short: "SM", color: "#546e7a", blurb: "Test periods and the random runs behind each result." },
};

/** Group key for a parameter path, for example "costs" for "costs.diesel_inr_per_l". */
export function groupKey(parameter: string): string {
  return parameter.split(".")[0];
}

/** Group details for a group key. Unknown keys get a neutral tile. */
export function groupOf(key: string): Group {
  return GROUPS[key] ?? { label: key, ...UNKNOWN_GROUP };
}

/** One plain-language line per parameter, shown on its card and in its dialog. */
export const DESCRIPTIONS: Record<string, string> = {
  "network.road_factor": "Road distance is the straight-line distance times this factor, to allow for bends in roads.",
  "network.candidate_depots_per_distributor": "How many depots the engine may choose from for each distributor.",
  "network.alt_depot_max_km": "Longest trip allowed when a distributor is served from a depot other than its nearest.",
  "network.chilled_max_km": "Longest trip allowed for chilled stock, which goes off faster on long roads.",
  "catalogue.depots": "The four depots, with the city and coordinates of each.",
  "catalogue.distributors": "The 16 distributors served, with city, region and population.",
  "catalogue.size_factor": "Scales each distributor's demand by its population, so larger cities order more.",
  "catalogue.skus": "The products, with shelf life, case size, price and weight per case.",
  categories: "For each product group: the share of price realised, gross margin, disposal cost, heat and rain sensitivity, and the monthly seasonal pattern.",
  "demand.volume_scale": "Overall scale of simulated demand.",
  "demand.weekday_profile": "Relative sales on each day of the week, Monday first.",
  "demand.annual_growth": "Yearly growth applied to demand.",
  "demand.nb_dispersion_k": "How much daily demand varies around its average. A lower value means more spread out.",
  "demand.history_stockout_prob": "Share of past sales weeks that had a stock-out, which hides some true demand.",
  "demand.unannounced_promo": "Weekly chance of an unannounced promotion, the lift it gives, and the dip that follows.",
  "demand.regional_shock": "A two-week demand jump for one product group in one region, used to test surprises.",
  "calendar.festivals": "Festival dates, the regions they apply to, the days of build-up before each, and the uplift per product group.",
  "supply.plant_output_x_base_demand": "Plant output as a multiple of base demand.",
  "supply.receipt_every_days": "How often each depot receives fresh stock, by temperature class.",
  "supply.life_used_at_receipt": "Shelf life already used when stock reaches the depot: a share for ambient, days for chilled.",
  "supply.opening_cover_days": "Days of stock on hand at the start of the period, by temperature class.",
  "supply.distributor_storage_weeks": "How many weeks of stock a distributor can store.",
  "supply.distributor_credit_weeks": "How many weeks of credit a distributor gets before payment is due.",
  "planning.cadence_days": "How often orders are planned, by temperature class.",
  "planning.mrsl_fraction.GT": "Minimum share of shelf life that must remain when stock is shipped to channel GT.",
  "planning.fair_share_alpha": "Weight given to sharing short stock fairly between distributors. 0 is the current setting.",
  "planning.critical_ratio_clip": "Lowest and highest service-level ratio the engine will use when deciding how much to ship.",
  "planning.festival_prebuild": "How many days ahead stock is built before a festival, and the smallest uplift that triggers it.",
  "planning.lost_sales_breakpoints": "Quantile points that set the stock-out risk levels the engine tests.",
  "planning.waste_breakpoints": "Quantile points that set the expiry risk levels the engine tests.",
  "forecast.param_refit_weeks": "How often the forecast model re-fits its parameters, in weeks.",
  "forecast.weather_forecast_days": "How many days ahead the weather forecast is used.",
  "forecast.weather_noise": "Random error added to the weather forecast: the spread of temperature and of rain.",
  "costs.diesel_inr_per_l": "Diesel price used to work out fuel cost per kilometre.",
  "costs.ftl.AMB32": "Cost model for a 32 ft ambient full truck load: fixed cost, cost per km, fuel use and capacity.",
  "costs.ftl.REEF17": "Cost model for a 17 ft refrigerated full truck load: fixed cost, cost per km, fuel use and capacity.",
  "costs.ptl": "Cost model for part-load trucks, priced in distance bands per kg, with a minimum charge.",
  "costs.festival_freight_premium": "Extra freight cost in the busy months, and the multiplier applied.",
  "costs.stockout_penalty_x_margin": "Cost of a missed sale, as a multiple of the margin on that case.",
  "costs.holding_rate_annual": "Yearly cost of holding stock, as a share of its value.",
  "costs.expiry_claim_share": "Share of expired stock that is written off at full cost.",
  "carbon.diesel_kg_co2_per_l": "kg of CO2 emitted per litre of diesel burned.",
  "carbon.ptl_load_factor": "How full part-load trucks are on average.",
  "carbon.price_inr_per_kg": "Price charged per kg of CO2 emitted. Zero means no carbon cost is included.",
  "simulation.history": "Date range of the history the model learns from.",
  "simulation.test_window": "Date range of the test period that plans are scored on.",
  "simulation.seeds": "Number of random runs behind each result.",
  "simulation.delay_prob": "Chance a delivery is late: within a region, and between regions.",
  "simulation.payment_lag_days": "Days between delivery and payment received.",
};

/** Plain-language line for a parameter. Falls back to its group description. */
export function describe(parameter: string): string {
  return DESCRIPTIONS[parameter] ?? groupOf(groupKey(parameter)).blurb;
}

/** A row is judgment when it has no source or its source is the word "judgment". */
export function isJudgment(row: AssumptionRow): boolean {
  return !row.source || row.source === "judgment";
}

/** Numbers as they are, booleans as yes or no, empty values as a dash. */
export function formatValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Short value for a card: primitives as they are, short lists inline, longer structures as a count. */
export function summarizeValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length > 0 && value.length <= 8 && value.every((v) => typeof v !== "object" || v === null)) {
      return value.map(formatValue).join(" · ");
    }
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    // Small flat objects, such as per-temperature-class settings, read best with their keys shown.
    if (entries.length > 0 && entries.length <= 4 && entries.every(([, v]) => v === null || typeof v !== "object")) {
      return entries.map(([k, v]) => `${k} ${formatValue(v)}`).join(" · ");
    }
    const count = entries.length;
    return `${count} ${count === 1 ? "field" : "fields"}`;
  }
  return formatValue(value);
}

/** Units are shown on cards only for single values, where the unit describes the value. */
export function isScalar(value: unknown): boolean {
  return value === null || value === undefined || typeof value !== "object";
}
