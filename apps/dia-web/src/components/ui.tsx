/** Shared UI pieces. Styles live in theme.css (docs/Design.md); components only choose classes. */
import type { Reason } from "@dia/types";
import { useEffect, useState, type ReactNode } from "react";

const RC_VAR: Record<string, string> = {
  CHEAPEST_SOURCE: "--rc-cheapest-source",
  EXPIRY_PUSH: "--rc-expiry-push",
  CLIFF_RESCUE: "--rc-cliff-rescue",
  FTL_TOPUP: "--rc-ftl-topup",
  FESTIVAL_UPLIFT: "--rc-festival-uplift",
  WEATHER_SHIFT: "--rc-weather-shift",
};

export function ReasonChips({ reasons }: { reasons: Reason[] | undefined }) {
  return (
    <>
      {(reasons ?? []).map((r) => (
        <span key={r.code + r.detail} className="chip" title={r.detail}
          style={{ background: `var(${RC_VAR[r.code] ?? "--rc-limited"})` }}>
          {r.code.replaceAll("_", " ")}
        </span>
      ))}
    </>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/** One metric tile. `tone` colours the hint (good = better than the comparison, bad = worse). */
export function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className={`hint ${tone ?? ""}`}>{hint}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p className="muted" style={{ color: "inherit" }}>{children}</p>}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? "on" : ""} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Horizontal meter, 0-100. */
export function Bar({ pct, label }: { pct: number; label?: string }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <span className={`bar ${p >= 85 ? "high" : p < 50 ? "low" : ""}`} role="img" aria-label={label ?? `${p.toFixed(0)} percent`} title={label ?? `${p.toFixed(0)}%`}>
      <span style={{ width: `${p}%` }} />
    </span>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  return error ? <p className="error">{error instanceof Error ? error.message : String(error)}</p> : null;
}

/** Load data on mount / when deps change. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data?: T; error?: unknown; reload: () => void } {
  const [state, setState] = useState<{ data?: T; error?: unknown }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fn().then((data) => live && setState({ data }), (error) => live && setState({ error }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}

/** Navigation and brand icons (24px grid, stroke only). */
export const Icon = {
  mark: (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="5" r="2" /><circle cx="5" cy="18" r="2" /><circle cx="19" cy="18" r="2" /><path d="M12 7l-6 9M12 7l6 9M7 18h10" />
    </svg>
  ),
  plan: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>,
  map: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" /></svg>,
  truck: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /></svg>,
  inbox: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5" /></svg>,
  results: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
  frontier: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18M7 15c3 0 3-6 6-6s3-3 6-3" /></svg>,
  history: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8M3 3v5h5M12 7v5l3 2" /></svg>,
  stock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" /></svg>,
  book: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3zM5 17a3 3 0 013-3h11" /></svg>,
};
