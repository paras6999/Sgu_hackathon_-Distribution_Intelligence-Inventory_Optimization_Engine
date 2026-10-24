/** App shell (owner: M2). Tabs follow the user journeys in docs/PRD.md section 4. */
import type { Plan } from "@dia/types";
import { useState } from "react";
import { api } from "./api";
import { useLoad } from "./components/ui";
import { AssumptionsPage, FrontierPage, MapPage, ResultsPage } from "./pages/AnalyticsPages";
import { DispatchPage } from "./pages/DispatchPage";
import { InboxPage } from "./pages/InboxPage";
import { PlanPage } from "./pages/PlanPage";

const TABS = ["Plan", "Map", "Dispatch", "Distributor inbox", "Results", "Frontier & Ablation", "Assumptions"] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [tab, setTab] = useState<Tab>("Plan");
  const [plan, setPlan] = useState<Plan | null>(null);
  const health = useLoad(api.health, []);

  return (
    <div className="shell">
      <header className="header">
        <h1>Vitaran</h1>
        <span className="badge">Distribution Intelligence</span>
        {health.data && <span className={`badge ${health.data.fake_backend ? "fake" : ""}`}>
          {health.data.fake_backend ? "FAKE DATA" : `engine: ${health.data.engine_mode} · ${health.data.engine}`}
        </span>}
        {health.error ? <span className="badge fake">backend unreachable</span> : null}
      </header>
      <nav className="tabs">
        {TABS.map((t) => <button key={t} className={t === tab ? "active" : ""} onClick={() => setTab(t)}>{t}</button>)}
      </nav>
      {tab === "Plan" && <PlanPage plan={plan} setPlan={setPlan} />}
      {tab === "Map" && <MapPage plan={plan} />}
      {tab === "Dispatch" && <DispatchPage plan={plan} />}
      {tab === "Distributor inbox" && <InboxPage plan={plan} setPlan={setPlan} />}
      {tab === "Results" && <ResultsPage />}
      {tab === "Frontier & Ablation" && <FrontierPage />}
      {tab === "Assumptions" && <AssumptionsPage />}
    </div>
  );
}
