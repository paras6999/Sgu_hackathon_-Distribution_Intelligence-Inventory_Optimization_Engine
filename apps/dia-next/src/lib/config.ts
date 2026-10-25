import type { AssistantRequest, ExperimentRequest } from "@dia/types";

/** Fixed inputs for the MVP demo. The plan request and the at-risk call both use AS_OF. */
export const AS_OF = "2025-09-29";

/** localStorage key that holds the plan id the page works on. */
export const PLAN_STORAGE_KEY = "vitaran.planId";

/** Credit use at or above this percentage counts as full (amber in the UI). */
export const CREDIT_FULL_PCT = 99.5;

export type UiMode = "automatic" | "ask_first" | "by_hand";

export const MODE_OPTIONS: { id: UiMode; label: string }[] = [
  { id: "automatic", label: "Automatic" },
  { id: "ask_first", label: "Ask me first" },
  { id: "by_hand", label: "By hand" },
];

export const DEPOTS: { id: string; name: string }[] = [
  { id: "W1-Bhiwandi", name: "Bhiwandi" },
  { id: "N1-Gurugram", name: "Gurugram" },
  { id: "S1-Hosur", name: "Hosur" },
  { id: "E1-Dankuni", name: "Dankuni" },
];

export const QUICK_PROMPTS = [
  "Check status",
  "Why did Hyderabad change?",
  "What if diesel goes up 10%?",
  "Approve and send",
];

/** Pages of the app. The assistant uses the same ids in its `page` field. */
export type PageId = NonNullable<AssistantRequest["page"]>;

export const PAGE_PATHS: Record<PageId, string> = {
  planning: "/",
  demand: "/demand",
  results: "/results",
  frontier: "/frontier",
  map: "/map",
  stock: "/stock",
};

/** Header links, in display order. */
export const NAV_ITEMS: { page: PageId; label: string }[] = [
  { page: "planning", label: "Planning" },
  { page: "demand", label: "Demand analysis" },
  { page: "results", label: "Results" },
  { page: "map", label: "Map" },
  { page: "frontier", label: "Frontier & Ablation" },
  { page: "stock", label: "Stock watch" },
];

/** The stored evaluation run that the results, frontier and stock pages read first. */
export const RESULT_EXPERIMENT_ID = process.env.NEXT_PUBLIC_EXPERIMENT_ID ?? "EX-acbb64e044eb";

/** Started only when the stored run is missing or failed. Keys stay in this order. */
export const MAIN_EXPERIMENT: ExperimentRequest = {
  policies: ["engine", "baseline_a", "baseline_b", "abl_no_expiry", "abl_no_truck_steps", "abl_uniform_service"],
  seeds: 10,
  opening_states: ["neutral", "imbalanced"],
};

/** How often a running evaluation is polled, in milliseconds. */
export const POLL_MS = 5000;
