/** App shell: sidebar navigation grouped by what the planner is doing. Journeys follow docs/PRD.md section 4. */
import type { Plan } from "@dia/types";
import { useState, type ReactNode } from "react";
import { api } from "./api";
import { Icon, useLoad } from "./components/ui";
import { DemandPage } from "./pages/DemandPage";
import { AssumptionsPage, FrontierPage, MapPage, ResultsPage } from "./pages/AnalyticsPages";
import { DispatchPage } from "./pages/DispatchPage";
import { InboxPage } from "./pages/InboxPage";
import { PlanPage } from "./pages/PlanPage";

const GROUPS: Array<{ title: string; items: Array<{ tab: string; icon: ReactNode }> }> = [
  { title: "Planning", items: [{ tab: "Plan", icon: Icon.plan }, { tab: "Map", icon: Icon.map }, { tab: "Dispatch", icon: Icon.truck }, { tab: "Distributor inbox", icon: Icon.inbox }] },
  { title: "Evaluation", items: [{ tab: "Demand analysis", icon: Icon.history }, { tab: "Results", icon: Icon.results }, { tab: "Frontier & Ablation", icon: Icon.frontier }] },
  { title: "Reference", items: [{ tab: "Assumptions", icon: Icon.book }] },
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
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">{Icon.mark}</div>
          <div>
            <div className="brand-name">Vitaran</div>
            <div className="brand-tag">Distribution intelligence</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="nav-group">{g.title}</div>
              {g.items.map((i) => (
                <button key={i.tab} className={i.tab === tab ? "active" : ""} aria-current={i.tab === tab ? "page" : undefined} onClick={() => setTab(i.tab)}>
                  {i.icon}<span>{i.tab}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="status">
            <span className={`dot ${h && !fake && h.engine === "ok" ? "" : "off"}`} />
            <span>{health.error ? "Backend unreachable" : fake ? "Demo data (no engine)" : h ? `Engine ${h.engine === "ok" ? "online" : h.engine} · ${h.engine_mode}` : "Connecting…"}</span>
          </div>
          <div className="sub">Simulated sales and stock; real weather</div>
        </div>
      </aside>
      <main className="main">
        <div className="page">
          {tab === "Plan" && <PlanPage plan={plan} setPlan={setPlan} />}
          {tab === "Map" && <MapPage plan={plan} />}
          {tab === "Dispatch" && <DispatchPage plan={plan} />}
          {tab === "Distributor inbox" && <InboxPage plan={plan} setPlan={setPlan} />}
          {tab === "Demand analysis" && <DemandPage />}
          {tab === "Results" && <ResultsPage />}
          {tab === "Frontier & Ablation" && <FrontierPage />}
          {tab === "Assumptions" && <AssumptionsPage />}
        </div>
      </main>
    </div>
  );
}
