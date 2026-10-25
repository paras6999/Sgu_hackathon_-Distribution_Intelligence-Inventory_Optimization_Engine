"use client";

import type { ReactNode } from "react";
import { useApp } from "@/context/AppContext";
import { AssistantPanel } from "./AssistantPanel";
import { FooterBar } from "./FooterBar";
import { Header } from "./Header";

/** The frame every page shares: header, the page on the left, the assistant on the right, footer. */
export function Shell({ children }: { children: ReactNode }) {
  const { plan, orders, error } = useApp();

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
          {children}
        </div>
        <AssistantPanel />
      </div>
      <FooterBar plan={plan} orderCount={orders?.totals.orders ?? null} />
    </div>
  );
}
