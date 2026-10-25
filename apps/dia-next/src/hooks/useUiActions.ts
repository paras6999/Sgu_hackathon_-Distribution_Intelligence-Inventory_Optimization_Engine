"use client";

import { useEffect, useRef } from "react";
import type { UiAction } from "@dia/types";
import { useApp } from "@/context/AppContext";

/**
 * Registers this page's handler for assistant actions that change the view (set_filters, select_lane).
 * The handler is read through a ref, so a new function each render does not re-register.
 */
export function useUiActions(handler: (action: UiAction) => void) {
  const { registerUiHandler } = useApp();
  const latest = useRef(handler);

  useEffect(() => {
    latest.current = handler;
  }, [handler]);

  useEffect(() => registerUiHandler((action) => latest.current(action)), [registerUiHandler]);
}
