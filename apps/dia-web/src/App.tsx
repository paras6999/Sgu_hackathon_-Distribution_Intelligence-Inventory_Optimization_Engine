/** App shell: top bar and tab navigation grouped by what the planner is doing. Journeys follow docs/PRD.md section 4. */
import type { Plan } from "@dia/types";
import { useState, type ReactNode } from "react";
import { api } from "./api";
import { AssistantPanel } from "./components/AssistantPanel";
import { Icon, useLoad } from "./components/ui";
import { DemandPage } from "./pages/DemandPage";
import { AssumptionsPage, FrontierPage, MapPage, ResultsPage } from "./pages/AnalyticsPages";
import { GuidePage } from "./pages/GuidePage";
import { DispatchPage } from "./pages/DispatchPage";
import { InboxPage } from "./pages/InboxPage";
import { PlanPage } from "./pages/PlanPage";
import { StockPage } from "./pages/StockPage";
import { WarehousesPage } from "./pages/WarehousesPage";

const GROUPS: Array<{ title: string; items: Array<{ tab: string; icon: ReactNode }> }> = [
  { title: "Planning", items: [{ tab: "Plan", icon: Icon.plan }, { tab: "Map", icon: Icon.map }, { tab: "Dispatch", icon: Icon.truck }, { tab: "Orders by city", icon: Icon.inbox }, { tab: "Stock watch", icon: Icon.stock }, { tab: "Warehouses", icon: Icon.warehouse }] },
  { title: "Evaluation", items: [{ tab: "Demand analysis", icon: Icon.history }, { tab: "Results", icon: Icon.results }, { tab: "Frontier & Ablation", icon: Icon.frontier }] },
  { title: "Reference", items: [{ tab: "Guide", icon: Icon.book }, { tab: "Assumptions", icon: Icon.book }] },
];
type Tab = (typeof GROUPS)[number]["items"][number]["tab"];

export function App() {
  const [tab, setTab] = useState<Tab>("Plan");
  const [plan, setPlan] = useState<Plan | null>(null);
  const health = useLoad(api.health, []);
  const h = health.data;
  const fake = !!h?.fake_backend;

  return (
    <div className="app">
      <header className="global">
        <div className="brand-mark">{Icon.mark}</div>
        <span className="brand-name">Vitaran</span>
        <span className="brand-tag">Distribution intelligence</span>
        <span className="spacer" />
        <div className="status">
          <span className={`dot ${h && !fake && h.engine === "ok" ? "" : "off"}`} />
          <span>{health.error ? "Backend unreachable" : fake ? "Demo data (no engine)" : h ? `Engine ${h.engine === "ok" ? "online" : h.engine} · ${h.engine_mode}` : "Connecting…"}</span>
        </div>
      </header>
      <nav className="nav" aria-label="Main">
        {GROUPS.map((g) => (
          <div className="nav-group" key={g.title}>
            <span>{g.title}</span>
            {g.items.map((i) => (
              <button key={i.tab} className={i.tab === tab ? "active" : ""} aria-current={i.tab === tab ? "page" : undefined} onClick={() => setTab(i.tab)}>
                {i.icon}<span>{i.tab}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="workspace">
      <main className="main">
        <div className="page">
          {tab === "Plan" && <PlanPage plan={plan} setPlan={setPlan} />}
          {tab === "Map" && <MapPage plan={plan} />}
          {tab === "Dispatch" && <DispatchPage plan={plan} />}
          {tab === "Orders by city" && <InboxPage plan={plan} setPlan={setPlan} />}
          {tab === "Stock watch" && <StockPage plan={plan} />}
          {tab === "Warehouses" && <WarehousesPage plan={plan} />}
          {tab === "Demand analysis" && <DemandPage />}
          {tab === "Results" && <ResultsPage />}
          {tab === "Frontier & Ablation" && <FrontierPage />}
          {tab === "Guide" && <GuidePage />}
          {tab === "Assumptions" && <AssumptionsPage />}
        </div>
      </main>
      <AssistantPanel plan={plan} setPlan={setPlan} />
      </div>
      <footer className="foot">
        <span><b>Plan</b> {plan ? `${plan.plan_id} v${plan.version} · ${plan.status}` : "none yet"}</span>
        <span className="spacer" />
        <span>Simulated sales and stock; real weather</span>
      </footer>
    </div>
  );
}
