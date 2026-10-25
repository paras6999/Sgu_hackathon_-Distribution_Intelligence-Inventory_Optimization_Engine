"use client";

import { useEffect, useMemo } from "react";
import type { AssistantContext } from "@dia/types";
import { useApp } from "@/context/AppContext";
import type { PageId } from "@/lib/config";

/**
 * Tells the assistant which page is on screen, what it shows, and which quick prompts to offer.
 * The value is published on mount, re-published when the inputs change, and cleared on unmount.
 */
export function usePageContext({
  page,
  context,
  prompts,
}: {
  page: PageId;
  context: AssistantContext;
  prompts: string[];
}) {
  const { setPageContext } = useApp();
  // Pages pass fresh objects on every render. Comparing the JSON keeps the effect from looping.
  const contextKey = JSON.stringify(context);
  const promptsKey = JSON.stringify(prompts);
  const value = useMemo(
    () => ({
      page,
      context: JSON.parse(contextKey) as AssistantContext,
      prompts: JSON.parse(promptsKey) as string[],
    }),
    [page, contextKey, promptsKey],
  );

  useEffect(() => {
    setPageContext(value);
    return () => setPageContext(null);
  }, [value, setPageContext]);
}
