"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AssistantTurn, ChatTurn } from "@/hooks/useAssistant";
import { QUICK_PROMPTS, type UiMode } from "@/lib/config";
import { WorkCard, type WorkOutcome } from "./AssistantSteps";

type Props = {
  ready: boolean;
  mode: UiMode;
  turns: ChatTurn[];
  onSend: (text: string) => void;
  onConfirm: (turn: AssistantTurn) => void;
  onCancel: (turnId: number) => void;
};

function AssistantMessage({
  turn,
  onConfirm,
  onCancel,
}: {
  turn: AssistantTurn;
  onConfirm: (turn: AssistantTurn) => void;
  onCancel: (turnId: number) => void;
}) {
  const { response, error } = turn;
  const outcome: WorkOutcome = error ? "error" : response ? response.status : "pending";
  const failed = outcome === "failed" || outcome === "error";
  const reply = error ?? response?.reply ?? null;
  // By hand never shows Confirm, so the assistant cannot act from this view.
  const canConfirm =
    response?.status === "needs_confirmation" && turn.mode !== "by_hand" && !turn.resolved;

  return (
    <div className="msg sys">
      <div className="who">Assistant</div>
      <WorkCard outcome={outcome} steps={response?.steps ?? []} />
      {reply && <p className={`reply${failed ? " error" : ""}`}>{reply}</p>}
      {canConfirm && (
        <div className="confirm-row">
          <button type="button" className="btn primary small" onClick={() => onConfirm(turn)}>
            Confirm
          </button>
          <button type="button" className="btn small" onClick={() => onCancel(turn.id)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

export function AssistantPanel({ ready, mode, turns, onSend, onConfirm, onCancel }: Props) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [turns]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !ready) return;
    setDraft("");
    onSend(text);
  };

  return (
    <aside className="assist" aria-label="Assistant">
      <h2 className="assist-head">
        <span className="dot" aria-hidden="true" />
        Assistant
        <small>acts on this plan</small>
      </h2>
      {mode === "by_hand" && (
        <p className="assist-note">By hand: the assistant suggests but does not act</p>
      )}
      <div className="log" ref={logRef}>
        <div className="msg sys">
          <div className="who">Assistant</div>
          <p>
            Ask about any order, check status, or tell me what to do. I only quote numbers from
            this plan.
          </p>
        </div>
        {turns.map((turn) =>
          turn.kind === "user" ? (
            <div key={turn.id} className="msg you">
              <div className="who">You</div>
              <p>{turn.text}</p>
            </div>
          ) : (
            <AssistantMessage key={turn.id} turn={turn} onConfirm={onConfirm} onCancel={onCancel} />
          ),
        )}
      </div>
      <div className="suggest">
        {QUICK_PROMPTS.map((prompt) => (
          <button key={prompt} type="button" disabled={!ready} onClick={() => onSend(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
      <form className="ask" onSubmit={submit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask, or tell it what to do"
          aria-label="Message the assistant"
          disabled={!ready}
        />
        <button type="submit" disabled={!ready || draft.trim() === ""}>
          Send
        </button>
      </form>
    </aside>
  );
}
