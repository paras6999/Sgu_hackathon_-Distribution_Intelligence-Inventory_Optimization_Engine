import type {
  LineStatus,
  OrderSummary,
  PlanEventAction,
  ReasonCode,
  ShipMode,
  TempClass,
  TruckClass,
} from "@dia/types";
import { DEPOTS } from "./config";

const indian = new Intl.NumberFormat("en-IN");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type Tone = "ok" | "warn" | "muted" | "bad";

/** Numbers use Indian grouping, for example 1,00,000. */
export function formatNumber(value: number): string {
  return indian.format(value);
}

/** Adds a plus sign to positive values, so changes read as +15 or -89. */
export function formatSigned(value: number): string {
  return value > 0 ? `+${indian.format(value)}` : indian.format(value);
}

/** Rupees in lakh (1,00,000) and crore (1,00,00,000), for example ₹19.70 lakh. */
export function formatRupees(value: number, signed = false): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : signed && value > 0 ? "+" : "";
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} crore`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} lakh`;
  return `${sign}₹${indian.format(Math.round(abs))}`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/** Takes an ISO date such as 2025-09-29 and returns 29 Sep 2025. */
export function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Shows a timestamp in India time, for example 29 Sep, 07:41. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

export function plural(count: number, word: string): string {
  return `${formatNumber(count)} ${word}${count === 1 ? "" : "s"}`;
}

export function planStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "PROPOSED":
      return "Sent";
    case "FINAL":
      return "Final";
    default:
      return status ?? "Unknown";
  }
}

export function orderStatus(order: OrderSummary): { label: string; tone: Tone } {
  switch (order.status) {
    case "TRIMMED":
      return { label: "Trimmed, replied", tone: "ok" };
    case "ACCEPTED":
      return { label: "Accepted, replied", tone: "ok" };
    case "REJECTED":
      return { label: "Rejected", tone: "bad" };
    case "EXPIRED":
      return { label: "Expired", tone: "muted" };
    default:
      return order.proposal_version > 1
        ? { label: "Updated", tone: "warn" }
        : { label: "Waiting", tone: "muted" };
  }
}

const LINE_STATUS: Record<LineStatus, string> = {
  PROPOSED: "Proposed",
  ACCEPTED: "Accepted",
  TRIMMED: "Trimmed",
  REJECTED: "Rejected",
};

export function lineStatusLabel(status: LineStatus | undefined): string {
  return status ? LINE_STATUS[status] : "Planned";
}

const REASON: Record<ReasonCode, string> = {
  CHEAPEST_SOURCE: "Cheapest source",
  EXPIRY_PUSH: "Ship before it expires",
  CLIFF_RESCUE: "Close to its shelf-life limit",
  FTL_TOPUP: "Fills a full truck",
  FESTIVAL_UPLIFT: "Festival demand",
  WEATHER_SHIFT: "Weather shifts demand",
  STOCK_LIMITED: "Not enough stock",
  CREDIT_LIMITED: "Credit limit reached",
  STORAGE_LIMITED: "Not enough storage",
  MRSL_BLOCKED: "Blocked by the shelf-life rule",
  FAIR_SHARE_FLOOR: "Fair share minimum",
};

export function reasonLabel(code: ReasonCode): string {
  return REASON[code];
}

const EVENT_ACTION: Record<PlanEventAction, string> = {
  accept: "Accepted",
  trim: "Trimmed",
  reject: "Rejected",
  override: "Changed by hand",
  grow: "Grew",
  publish: "Sent to distributors",
  replan: "Re-planned",
};

export function eventActionLabel(action: PlanEventAction): string {
  return EVENT_ACTION[action];
}

export function truckModeLabel(mode: ShipMode): string {
  return mode === "FTL" ? "Full truck" : "Part load";
}

export function truckClassLabel(truckClass: TruckClass | null | undefined): string {
  if (!truckClass) return "Not set";
  return truckClass.startsWith("REEF") ? "Chilled" : "Ambient";
}

export function tempLabel(temp: TempClass): string {
  return temp === "chilled" ? "Chilled" : "Ambient";
}

export function depotName(id: string): string {
  return DEPOTS.find((depot) => depot.id === id)?.name ?? id;
}
