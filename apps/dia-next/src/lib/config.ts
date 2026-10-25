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
