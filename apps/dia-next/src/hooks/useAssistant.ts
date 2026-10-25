"use client";

import { useCallback, useRef, useState } from "react";
import type { AssistantResponse } from "@dia/types";
import { ApiError, askAssistant, describeError } from "@/lib/api";
import type { UiMode } from "@/lib/config";

export type AssistantTurn = {
  kind: "assistant";
  id: number;
  /** The sentence the user sent, reused when the user confirms an action. */
  message: string;
  mode: UiMode;
  response: AssistantResponse | null;
  error: string | null;
  /** True once the user has confirmed or cancelled a pending action. */
  resolved: boolean;
};

export type ChatTurn = { kind: "user"; id: number; text: string } | AssistantTurn;

function patchTurn(turns: ChatTurn[], id: number, patch: Partial<AssistantTurn>): ChatTurn[] {
  return turns.map((turn) =>
    turn.kind === "assistant" && turn.id === id ? { ...turn, ...patch } : turn,
  );
}

function describeAssistantError(err: unknown): string {
  if (err instanceof ApiError && err.status === 404) return "Assistant is not connected yet.";
  return describeError(err);
}

/** Keeps the sidebar conversation. Each send adds a user line and an assistant turn. */
export function useAssistant() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const nextId = useRef(1);

  const send = useCallback(
    async (
      planId: string,
      message: string,
      mode: UiMode,
      confirm = false,
    ): Promise<AssistantResponse | null> => {
      const userId = nextId.current++;
      const turnId = nextId.current++;
      setTurns((prev) => [
        ...prev,
        { kind: "user", id: userId, text: confirm ? `Confirm: ${message}` : message },
        {
          kind: "assistant",
          id: turnId,
          message,
          mode,
          response: null,
          error: null,
          resolved: false,
        },
      ]);
      try {
        const response = await askAssistant({
          plan_id: planId,
          message,
          mode: mode === "automatic" ? "automatic" : "ask_first",
          ...(confirm ? { confirm: true } : {}),
        });
        setTurns((prev) => patchTurn(prev, turnId, { response }));
        return response;
      } catch (err) {
        setTurns((prev) => patchTurn(prev, turnId, { error: describeAssistantError(err) }));
        return null;
      }
    },
    [],
  );

  const resolve = useCallback((turnId: number) => {
    setTurns((prev) => patchTurn(prev, turnId, { resolved: true }));
  }, []);

  return { turns, send, resolve };
}
