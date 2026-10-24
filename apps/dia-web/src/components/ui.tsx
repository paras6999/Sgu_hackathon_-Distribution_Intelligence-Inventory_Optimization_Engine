/** Small shared UI pieces (owner: M2). */
import type { Reason } from "@dia/types";
import { useEffect, useState } from "react";

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
          {r.code}
        </span>
      ))}
    </>
  );
}

export function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
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

export function Placeholder({ owner, title, endpoints, children }: { owner: string; title: string; endpoints: string[]; children?: React.ReactNode }) {
  return (
    <div className="placeholder">
      <h2>{title}</h2>
      <p>Owner: <b>{owner}</b>. Build this page against <span className="mono">{endpoints.join(", ")}</span> (spec: docs/Design.md).</p>
      {children}
    </div>
  );
}
