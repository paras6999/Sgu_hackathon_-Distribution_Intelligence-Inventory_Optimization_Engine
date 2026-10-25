"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { OrderSummary, ResponseAction } from "@dia/types";
import { FreedCases } from "@/components/FreedCases";
import type { LineDecision } from "@/components/OrderLines";
import { OrdersTable } from "@/components/OrdersTable";
import { RecordHeader } from "@/components/RecordHeader";
import { Summary } from "@/components/Summary";
import { TabBody, Tabs, type TabId } from "@/components/Tabs";
import { useApp } from "@/context/AppContext";
import { usePageContext } from "@/hooks/usePageContext";
import { describeError, getOrders, getPlan, respondToOrder } from "@/lib/api";
import { QUICK_PROMPTS } from "@/lib/config";

export default function PlanningPage() {
  // useSearchParams needs a Suspense boundary so the page can still be prerendered.
  return (
    <Suspense fallback={null}>
      <Planning />
    </Suspense>
  );
}

function Planning() {
  const { planId, plan, orders, ordersError, loading, justUpdated, refresh, mode, setMode, ask } =
    useApp();
  const search = useSearchParams();
  const initialOpenDist = search.get("order") ?? undefined;
  const [tab, setTab] = useState<TabId>("orders");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const loaded = !loading;

  usePageContext({ page: "planning", context: {}, prompts: QUICK_PROMPTS });

  const orderList = useMemo(
    () => [...(orders?.orders ?? [])].sort((a, b) => b.value_inr - a.value_inr),
    [orders],
  );
  /** Orders can be answered only after the plan has been sent (proposal version 1 or more). */
  const canAct = orderList.some((o) => o.proposal_version >= 1);

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
    <section className="record" data-page="planning" data-ready={loaded ? "true" : "false"}>
      <RecordHeader
        plan={plan}
        orderCount={orders?.totals.orders ?? null}
        mode={mode}
        justUpdated={justUpdated}
        onModeChange={setMode}
        onApprove={() => void ask("approve and send")}
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
              initialOpenDist={initialOpenDist}
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
  );
}
