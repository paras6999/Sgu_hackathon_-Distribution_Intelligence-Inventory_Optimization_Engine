"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { AssistantContext, UiAction } from "@dia/types";
import { useAssistant, type AssistantTurn, type ChatTurn } from "@/hooks/useAssistant";
import { usePlan } from "@/hooks/usePlan";
import { PAGE_PATHS, type PageId, type UiMode } from "@/lib/config";

/** What the current page shows. Sent with every assistant message. */
export type PageContext = { page: PageId; context: AssistantContext; prompts: string[] };

export type UiActionHandler = (action: UiAction) => void;

type PlanState = ReturnType<typeof usePlan>;

export type AppState = PlanState & {
  turns: ChatTurn[];
  resolve: (turnId: number) => void;
  mode: UiMode;
  setMode: (mode: UiMode) => void;
  /** Sends a message. `confirm` answers a pending action; `askMode` defaults to the current mode. */
  ask: (message: string, confirm?: boolean, askMode?: UiMode) => Promise<void>;
  confirmTurn: (turn: AssistantTurn) => void;
  pageContext: PageContext | null;
  setPageContext: (value: PageContext | null) => void;
  /** Registers the current page's handler for set_filters and select_lane. Returns an unregister function. */
  registerUiHandler: (handler: UiActionHandler) => () => void;
};

const AppContext = createContext<AppState | null>(null);

/** Plan, assistant conversation, and the link between the assistant and the page on screen. */
export function AppProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const plan = usePlan();
  const { planId, refresh, switchPlan } = plan;
  const { turns, send, resolve } = useAssistant();
  const [mode, setMode] = useState<UiMode>("automatic");
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const uiHandler = useRef<UiActionHandler | null>(null);

  const registerUiHandler = useCallback((handler: UiActionHandler) => {
    uiHandler.current = handler;
    return () => {
      if (uiHandler.current === handler) uiHandler.current = null;
    };
  }, []);

  const dispatchUiAction = useCallback(
    (action: UiAction) => {
      if (action.type === "navigate") {
        if (action.page) router.push(PAGE_PATHS[action.page]);
        return;
      }
      uiHandler.current?.(action);
    },
    [router],
  );

  /** The one path for every assistant message, including Approve and the confirm button. */
  const ask = useCallback(
    async (message: string, confirm = false, askMode: UiMode = mode) => {
      if (!planId) return;
      const response = await send(planId, message, askMode, confirm, {
        page: pageContext?.page ?? "planning",
        context: pageContext?.context ?? {},
      });
      if (!response) return;
      if (response.ui_action) {
        dispatchUiAction(response.ui_action);
      } else if (response.plan_id && response.plan_id !== planId) {
        await switchPlan(response.plan_id);
      } else if (response.status === "completed") {
        await refresh();
      }
    },
    [planId, mode, pageContext, send, dispatchUiAction, switchPlan, refresh],
  );

  const confirmTurn = useCallback(
    (turn: AssistantTurn) => {
      resolve(turn.id);
      void ask(turn.message, true, turn.mode);
    },
    [resolve, ask],
  );

  const value: AppState = {
    ...plan,
    turns,
    resolve,
    mode,
    setMode,
    ask,
    confirmTurn,
    pageContext,
    setPageContext,
    registerUiHandler,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp must be used inside AppProvider.");
  return value;
}
