"use client";

import { useEffect, useState } from "react";
import type { AtRisk, DispatchTruck, Plan, PlanEvent } from "@dia/types";
import { describeError, getAtRisk, getDispatch, getEvents } from "@/lib/api";
import { AS_OF, DEPOTS } from "@/lib/config";
import {
  eventActionLabel,
  formatDate,
  formatDateTime,
  formatNumber,
  formatRupees,
  truckClassLabel,
  truckModeLabel,
} from "@/lib/format";

export type TabId = "orders" | "trucks" | "depots" | "risk" | "changes";

const TABS: { id: TabId; label: string }[] = [
  { id: "orders", label: "Orders" },
  { id: "trucks", label: "Trucks" },
  { id: "depots", label: "Depots" },
  { id: "risk", label: "Stock at risk" },
  { id: "changes", label: "Changes" },
];

type TabsProps = {
  active: TabId;
  orderCount: number | null;
  onChange: (tab: TabId) => void;
};

export function Tabs({ active, orderCount, onChange }: TabsProps) {
  return (
    <nav className="tabs" aria-label="Plan sections">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`tab${active === tab.id ? " on" : ""}`}
          aria-pressed={active === tab.id}
          onClick={() => onChange(tab.id)}
        >
          {tab.id === "orders" && orderCount !== null ? `Orders (${orderCount})` : tab.label}
        </button>
      ))}
    </nav>
  );
}

/** A query result tagged with the key it was made for, so a stale result is never shown. */
type Loaded<T> = { key: string; data?: T; error?: string };

function Notice({ text, error }: { text: string; error?: boolean }) {
  return <p className={error ? "notice error" : "empty"}>{text}</p>;
}

function truckCases(truck: DispatchTruck): number {
  return truck.lines.reduce((sum, line) => sum + line.cases, 0);
}

/** Trucks leaving one depot, with a depot picker. */
export function TrucksTab({ planId, version }: { planId: string; version: number }) {
  const [depot, setDepot] = useState(DEPOTS[0].id);
  const [result, setResult] = useState<Loaded<DispatchTruck[]> | null>(null);
  const key = `${planId}|${version}|${depot}`;

  useEffect(() => {
    let active = true;
    getDispatch(planId, depot).then(
      (data) => {
        if (active) setResult({ key, data: data.trucks });
      },
      (err: unknown) => {
        if (active) setResult({ key, error: describeError(err) });
      },
    );
    return () => {
      active = false;
    };
  }, [key, planId, depot]);

  const current = result?.key === key ? result : null;

  return (
    <>
      <div className="tools">
        {DEPOTS.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`chip${depot === d.id ? " on" : ""}`}
            aria-pressed={depot === d.id}
            onClick={() => setDepot(d.id)}
          >
            {d.name}
          </button>
        ))}
        <span className="spacer" />
        <span className="hint">Trucks leaving the selected depot</span>
      </div>
      {!current && <Notice text="Loading trucks…" />}
      {current?.error && <Notice text={current.error} error />}
      {current?.data && current.data.length === 0 && (
        <Notice text="No trucks leave this depot in the plan." />
      )}
      {current?.data && current.data.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Truck</th>
                <th>Type</th>
                <th>Going to</th>
                <th>Ship date</th>
                <th className="num">Cases</th>
                <th className="num">Weight used</th>
                <th className="num">Space used</th>
                <th className="num">Freight</th>
              </tr>
            </thead>
            <tbody>
              {current.data.map((item) => (
                <tr key={item.truck.truck_id}>
                  <td>{item.truck.truck_id}</td>
                  <td>
                    {truckModeLabel(item.truck.mode)}, {truckClassLabel(item.truck.truck_class)}
                  </td>
                  <td>{item.truck.to_id}</td>
                  <td>{formatDate(item.truck.ship_date)}</td>
                  <td className="num">{formatNumber(truckCases(item))}</td>
                  <td className="num">{Math.round(item.truck.kg_pct)}%</td>
                  <td className="num">{Math.round(item.truck.m3_pct)}%</td>
                  <td className="num">{formatRupees(item.truck.cost_inr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

type DepotRow = { id: string; name: string; trucks: number; cases: number; freight: number };

/** One row per depot: how many trucks it sends this week, the cases, and the freight. */
export function DepotsTab({ planId, version }: { planId: string; version: number }) {
  const [result, setResult] = useState<Loaded<DepotRow[]> | null>(null);
  const key = `${planId}|${version}`;

  useEffect(() => {
    let active = true;
    Promise.all(DEPOTS.map((d) => getDispatch(planId, d.id))).then(
      (responses) => {
        const rows = DEPOTS.map((d, i) => {
          const trucks = responses[i].trucks;
          return {
            id: d.id,
            name: d.name,
            trucks: trucks.length,
            cases: trucks.reduce((sum, t) => sum + truckCases(t), 0),
            freight: trucks.reduce((sum, t) => sum + t.truck.cost_inr, 0),
          };
        });
        if (active) setResult({ key, data: rows });
      },
      (err: unknown) => {
        if (active) setResult({ key, error: describeError(err) });
      },
    );
    return () => {
      active = false;
    };
  }, [key, planId]);

  const current = result?.key === key ? result : null;
  if (!current) return <Notice text="Loading depots…" />;
  if (current.error) return <Notice text={current.error} error />;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Depot</th>
            <th className="num">Trucks</th>
            <th className="num">Cases</th>
            <th className="num">Freight</th>
          </tr>
        </thead>
        <tbody>
          {(current.data ?? []).map((row) => (
            <tr key={row.id}>
              <td>
                <b>{row.name}</b> <span className="muted">{row.id}</span>
              </td>
              <td className="num">{formatNumber(row.trucks)}</td>
              <td className="num">{formatNumber(row.cases)}</td>
              <td className="num">{formatRupees(row.freight)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Stock close to its shelf-life limit, held by depots and distributors. */
export function RiskTab({ scenarioId }: { scenarioId: string }) {
  const [result, setResult] = useState<Loaded<AtRisk[]> | null>(null);
  const key = scenarioId;

  useEffect(() => {
    let active = true;
    getAtRisk(scenarioId, AS_OF).then(
      (data) => {
        if (active) setResult({ key, data });
      },
      (err: unknown) => {
        if (active) setResult({ key, error: describeError(err) });
      },
    );
    return () => {
      active = false;
    };
  }, [key, scenarioId]);

  const current = result?.key === key ? result : null;
  if (!current) return <Notice text="Loading stock at risk…" />;
  if (current.error) return <Notice text={current.error} error />;
  const rows = current.data ?? [];
  if (rows.length === 0) return <Notice text="No stock is at risk of expiring before it sells." />;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Held by</th>
            <th>City</th>
            <th>Product</th>
            <th>Expiry</th>
            <th className="num">Stock</th>
            <th>Suggested action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.dist_id}-${row.sku_id}-${row.lot_id ?? i}`}>
              <td>{row.holder_type === "depot" ? "Depot" : "Distributor"}</td>
              <td>{row.dist_city}</td>
              <td>{row.sku_name}</td>
              <td>{formatDate(row.expiry)}</td>
              <td className="num">{formatNumber(row.stock_cases)} cases</td>
              <td>{row.suggested_action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The plan's change history: trims, replies, and changes made by hand. */
export function ChangesTab({ planId, version }: { planId: string; version: number }) {
  const [result, setResult] = useState<Loaded<PlanEvent[]> | null>(null);
  const key = `${planId}|${version}`;

  useEffect(() => {
    let active = true;
    getEvents(planId).then(
      (data) => {
        if (active) setResult({ key, data });
      },
      (err: unknown) => {
        if (active) setResult({ key, error: describeError(err) });
      },
    );
    return () => {
      active = false;
    };
  }, [key, planId]);

  const current = result?.key === key ? result : null;
  if (!current) return <Notice text="Loading changes…" />;
  if (current.error) return <Notice text={current.error} error />;
  const events = current.data ?? [];
  if (events.length === 0) return <Notice text="No changes have been made to this plan yet." />;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Action</th>
            <th>Who</th>
            <th>Distributor</th>
            <th className="num">Cases</th>
            <th className="num">Cost change</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, i) => (
            <tr key={`${event.ts}-${i}`}>
              <td>{formatDateTime(event.ts)}</td>
              <td>{eventActionLabel(event.action)}</td>
              <td>{event.actor}</td>
              <td>{event.dist_id ?? "—"}</td>
              <td className="num">
                {event.old_qty != null && event.new_qty != null
                  ? `${formatNumber(event.old_qty)} to ${formatNumber(event.new_qty)}`
                  : "—"}
              </td>
              <td className="num">{formatRupees(event.delta_cost_inr ?? 0, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Renders the active non-orders tab. The orders tab is rendered by the page. */
export function TabBody({ tab, plan }: { tab: Exclude<TabId, "orders">; plan: Plan }) {
  switch (tab) {
    case "trucks":
      return <TrucksTab planId={plan.plan_id} version={plan.version} />;
    case "depots":
      return <DepotsTab planId={plan.plan_id} version={plan.version} />;
    case "risk":
      return <RiskTab scenarioId={plan.scenario_id} />;
    case "changes":
      return <ChangesTab planId={plan.plan_id} version={plan.version} />;
  }
}
