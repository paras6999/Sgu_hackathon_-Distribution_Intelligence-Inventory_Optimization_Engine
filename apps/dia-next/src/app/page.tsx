"use client";

import { useCallback, useMemo, useState } from "react";
import { AssistantPanel } from "@/components/AssistantPanel";
import { FooterBar } from "@/components/FooterBar";
import { FreedCases } from "@/components/FreedCases";
import { Header } from "@/components/Header";
import { OrderDetail } from "@/components/OrderDetail";
import { OrdersTable } from "@/components/OrdersTable";
import { RecordHeader } from "@/components/RecordHeader";
import { Summary } from "@/components/Summary";
import { TabBody, Tabs, type TabId } from "@/components/Tabs";
import { useAssistant, type AssistantTurn } from "@/hooks/useAssistant";
import { usePlan } from "@/hooks/usePlan";
import type { UiMode } from "@/lib/config";

export default function Home() {
  const { planId, plan, orders, ordersError, error, loading, justUpdated, refresh, switchPlan } =
    usePlan();
  const { turns, send, resolve } = useAssistant();
  const [mode, setMode] = useState<UiMode>("automatic");
  const [tab, setTab] = useState<TabId>("orders");
  const [selectedDist, setSelectedDist] = useState<string | null>(null);

  const orderList = useMemo(
    () => [...(orders?.orders ?? [])].sort((a, b) => b.value_inr - a.value_inr),
    [orders],
  );
  const selected = orderList.find((o) => o.dist_id === selectedDist) ?? orderList[0] ?? null;
  const selectedLines = plan && selected ? plan.lines.filter((l) => l.to_id === selected.dist_id) : [];

  /** The one path for every assistant message, including Approve and the confirm button. */
  const ask = useCallback(
    async (message: string, askMode: UiMode, confirm = false) => {
      if (!planId) return;
      const response = await send(planId, message, askMode, confirm);
      if (!response) return;
      if (response.plan_id && response.plan_id !== planId) {
        await switchPlan(response.plan_id);
      } else if (response.status === "completed") {
        await refresh();
      }
    },
    [planId, send, switchPlan, refresh],
  );

  const confirmTurn = (turn: AssistantTurn) => {
    resolve(turn.id);
    void ask(turn.message, turn.mode, true);
  };

  return (
    <div className="app">
      <Header />
      <div className="layout">
        <div className="main-col">
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          <section className="record">
            <RecordHeader
              plan={plan}
              orderCount={orders?.totals.orders ?? null}
              mode={mode}
              justUpdated={justUpdated}
              onModeChange={setMode}
              onApprove={() => void ask("approve and send", mode)}
            />
            <Summary orders={orders} />
            <Tabs active={tab} orderCount={orders?.totals.orders ?? null} onChange={setTab} />
            {!plan && (
              <p className="empty">
                {loading ? "Loading the plan…" : "The plan could not be loaded. Check that the backend is running."}
              </p>
            )}
            {plan && tab === "orders" && (
              orders ? (
                <>
                  <OrdersTable
                    orders={orderList}
                    selectedDist={selected?.dist_id ?? null}
                    onSelect={setSelectedDist}
                  />
                  <div className="below">
                    <OrderDetail order={selected} lines={selectedLines} />
                    <FreedCases orders={orderList} totals={orders.totals} />
                  </div>
                </>
              ) : (
                <p className="empty">{ordersError ?? "Orders are not available yet."}</p>
              )
            )}
            {plan && tab !== "orders" && <TabBody tab={tab} plan={plan} />}
          </section>
        </div>

        <AssistantPanel
          ready={planId !== null}
          mode={mode}
          turns={turns}
          onSend={(text) => void ask(text, mode)}
          onConfirm={confirmTurn}
          onCancel={resolve}
        />
      </div>
      <FooterBar plan={plan} orderCount={orders?.totals.orders ?? null} />
    </div>
  );
}
