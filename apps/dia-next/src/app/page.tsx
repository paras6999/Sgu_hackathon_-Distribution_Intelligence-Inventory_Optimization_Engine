"use client";

import { useCallback, useMemo, useState } from "react";
import type { OrderSummary, ResponseAction } from "@dia/types";
import { AssistantPanel } from "@/components/AssistantPanel";
import { FooterBar } from "@/components/FooterBar";
import { FreedCases } from "@/components/FreedCases";
import { Header } from "@/components/Header";
import type { LineDecision } from "@/components/OrderLines";
import { OrdersTable } from "@/components/OrdersTable";
import { RecordHeader } from "@/components/RecordHeader";
import { Summary } from "@/components/Summary";
import { TabBody, Tabs, type TabId } from "@/components/Tabs";
import { useAssistant, type AssistantTurn } from "@/hooks/useAssistant";
import { usePlan } from "@/hooks/usePlan";
import { describeError, getOrders, getPlan, respondToOrder } from "@/lib/api";
import type { UiMode } from "@/lib/config";

export default function Home() {
  const { planId, plan, orders, ordersError, error, loading, justUpdated, refresh, switchPlan } =
    usePlan();
  const { turns, send, resolve } = useAssistant();
  const [mode, setMode] = useState<UiMode>("automatic");
  const [tab, setTab] = useState<TabId>("orders");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const orderList = useMemo(
    () => [...(orders?.orders ?? [])].sort((a, b) => b.value_inr - a.value_inr),
    [orders],
  );
  /** Orders can be answered only after the plan has been sent (proposal version 1 or more). */
  const canAct = orderList.some((o) => o.proposal_version >= 1);

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

  /** Records a reply on one order. Line ids change with every version, so the lines are read fresh. */
  const applyToOrder = async (order: OrderSummary, decisions: LineDecision[]) => {
    if (!planId) return;
    if (order.proposal_version < 1) {
      setNotice("Approve and send the plan first. Orders can be answered once they are sent.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await respondToOrder(planId, {
        dist_id: order.dist_id,
        proposal_version: order.proposal_version,
        actions: decisions,
      });
      setNotice(`${order.dist_city}: updated.`);
    } catch (err) {
      setNotice(describeError(err));
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  /** Accept or reject all lines of each checked order, one order after another. */
  const applyToMany = async (distIds: string[], action: ResponseAction) => {
    if (!planId || distIds.length === 0) return;
    setBusy(true);
    setNotice(null);
    let done = 0;
    try {
      for (const dist of distIds) {
        const [latest, view] = await Promise.all([getPlan(planId), getOrders(planId)]);
        const order = view.orders.find((o) => o.dist_id === dist);
        if (!order || order.proposal_version < 1) continue;
        const actions = latest.lines
          .filter((l) => l.to_id === dist)
          .map((l) => ({ line_id: l.line_id, action }));
        setNotice(`Updating ${done + 1} of ${distIds.length}…`);
        await respondToOrder(planId, {
          dist_id: dist,
          proposal_version: order.proposal_version,
          actions,
        });
        done += 1;
      }
      setNotice(done === 0 ? "Nothing to update: send the plan first." : `Updated ${done} order${done === 1 ? "" : "s"}.`);
    } catch (err) {
      setNotice(describeError(err));
    } finally {
      await refresh();
      setBusy(false);
    }
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
            {plan && tab === "orders" &&
              (orders ? (
                <>
                  {notice && <p className="notice">{notice}</p>}
                  <OrdersTable
                    orders={orderList}
                    lines={plan.lines}
                    canAct={canAct}
                    busy={busy}
                    onApplyOrder={(order, decisions) => void applyToOrder(order, decisions)}
                    onBulk={(distIds, action) => void applyToMany(distIds, action)}
                  />
                  <div className="below">
                    <FreedCases orders={orderList} totals={orders.totals} />
                  </div>
                </>
              ) : (
                <p className="empty">{ordersError ?? "Orders are not available yet."}</p>
              ))}
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
