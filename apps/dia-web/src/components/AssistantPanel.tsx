/**
 * Planner assistant sidebar, ported from apps/dia-next (Ammey Kuraaday's AssistantPanel, AssistantSteps, useAssistant).
 * Sentences go to POST /v1/assistant, which picks one of a fixed list of tools; the model never supplies a quantity.
 * Modes: Automatic acts, Ask me first waits for Confirm, By hand never acts from this panel.
 */
import type { AssistantResponse, AssistantStep, Plan } from "@dia/types";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";

export type UiMode = "automatic" | "ask_first" | "by_hand";
const MODE_OPTIONS: { id: UiMode; label: string }[] = [
  { id: "automatic", label: "Automatic" },
  { id: "ask_first", label: "Ask me first" },
  { id: "by_hand", label: "By hand" },
];
const QUICK_PROMPTS = ["Check status", "Why did Hyderabad change?", "What if diesel goes up 10%?", "Approve and send"];

type AssistantTurn = {
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
type ChatTurn = { kind: "user"; id: number; text: string } | AssistantTurn;

const patchTurn = (turns: ChatTurn[], id: number, patch: Partial<AssistantTurn>): ChatTurn[] =>
  turns.map((t) => (t.kind === "assistant" && t.id === id ? { ...t, ...patch } : t));

// ------------------------------------------------------------------------------------------- working card

type WorkOutcome = AssistantResponse["status"] | "pending" | "error";
const PHASES = ["Reading the plan", "Checking orders", "Running the step"];
const PHASE_MS = 1200;
const STEP_STAGGER_MS = 160;
/** How long the finished steps stay open before the card collapses. */
const HOLD_MS = 900;

function headline(outcome: WorkOutcome, stepCount: number, phase: string): string {
  const steps = stepCount === 1 ? "1 step" : `${stepCount} steps`;
  switch (outcome) {
    case "pending": return phase;
    case "completed": return stepCount > 0 ? `Done · ${steps}` : "Done";
    case "answered": return stepCount > 0 ? `Answered · ${steps}` : "Answered";
    case "needs_confirmation": return "Waiting for you to confirm";
    default: return "Failed";
  }
}

const Check = ({ cls }: { cls: string }) => (
  <svg className={cls} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const Cross = ({ cls }: { cls: string }) => (
  <svg className={cls} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7m0-7l-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
const Dash = ({ cls }: { cls: string }) => (
  <svg className={cls} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);

function OutcomeMark({ outcome }: { outcome: WorkOutcome }) {
  if (outcome === "pending") return <span className="pulse-dot" aria-hidden="true" />;
  if (outcome === "needs_confirmation") return <span className="wait-dot" aria-hidden="true" />;
  if (outcome === "completed" || outcome === "answered") return <Check cls="icon-ok" />;
  return <Cross cls="icon-bad" />;
}

function StepRow({ step, index }: { step: AssistantStep; index: number }) {
  const mark = step.status === "done" ? <Check cls="icon-ok" /> : step.status === "failed" ? <Cross cls="icon-bad" /> : <Dash cls="icon-muted" />;
  return <li className="step" style={{ animationDelay: `${index * STEP_STAGGER_MS}ms` }}>{mark}<span>{step.summary}</span></li>;
}

/** Runs expanded while the request is pending, reveals its steps one by one, then collapses to one line. */
function WorkCard({ outcome, steps }: { outcome: WorkOutcome; steps: AssistantStep[] }) {
  const pending = outcome === "pending";
  const failed = outcome === "failed" || outcome === "error";
  const canExpand = !pending && steps.length > 0;
  const [phase, setPhase] = useState(0);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const [autoCollapsed, setAutoCollapsed] = useState(false);

  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => setPhase((p) => (p + 1) % PHASES.length), PHASE_MS);
    return () => clearInterval(id);
  }, [pending]);
  useEffect(() => {
    if (pending || failed) return;                 // failed answers stay collapsed; the reply is already red
    const id = setTimeout(() => setAutoCollapsed(true), steps.length * STEP_STAGGER_MS + HOLD_MS);
    return () => clearTimeout(id);
  }, [pending, failed, steps.length]);

  const open = pending || (canExpand && (toggled ?? (!failed && !autoCollapsed)));
  return (
    <div className="work">
      <button type="button" className="work-head" aria-expanded={open} disabled={!canExpand} onClick={() => setToggled(!open)}>
        <OutcomeMark outcome={outcome} />
        <span className={`work-title${failed ? " text-bad" : ""}`}>{headline(outcome, steps.length, PHASES[phase] ?? "")}</span>
        {canExpand && <span className="work-toggle">{open ? "Collapse" : "Expand"}</span>}
      </button>
      <div className={`work-body${open ? " open" : ""}`}>
        <div className="work-inner">
          <div className="work-pad">
            {pending ? <div className="progress" /> : <ol className="steps">{steps.map((s, i) => <StepRow key={i} step={s} index={i} />)}</ol>}
          </div>
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ turn, onConfirm, onCancel }: { turn: AssistantTurn; onConfirm: (t: AssistantTurn) => void; onCancel: (id: number) => void }) {
  const { response, error } = turn;
  const outcome: WorkOutcome = error ? "error" : response ? response.status : "pending";
  const failed = outcome === "failed" || outcome === "error";
  const reply = error ?? response?.reply ?? null;
  // By hand never shows Confirm, so the assistant cannot act from this view.
  const canConfirm = response?.status === "needs_confirmation" && turn.mode !== "by_hand" && !turn.resolved;
  return (
    <div className="msg sys">
      <div className="who">Assistant{response?.source === "ai" ? " · AI" : ""}</div>
      <WorkCard outcome={outcome} steps={response?.steps ?? []} />
      {reply && <p className={`reply${failed ? " error" : ""}`}>{reply}</p>}
      {canConfirm && (
        <div className="confirm-row">
          <button type="button" className="primary small" onClick={() => onConfirm(turn)}>Confirm</button>
          <button type="button" className="small" onClick={() => onCancel(turn.id)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------- panel

export function AssistantPanel({ plan, setPlan }: { plan: Plan | null; setPlan: (p: Plan) => void }) {
  const [mode, setMode] = useState<UiMode>("automatic");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const nextId = useRef(1);
  const logRef = useRef<HTMLDivElement>(null);
  const planId = plan?.plan_id ?? null;

  useEffect(() => { const log = logRef.current; if (log) log.scrollTop = log.scrollHeight; }, [turns]);

  /** The one path for every message, including the quick prompts and Confirm. */
  const ask = useCallback(async (message: string, askMode: UiMode, confirm = false) => {
    if (!planId) return;
    const userId = nextId.current++, turnId = nextId.current++;
    setTurns((prev) => [...prev,
      { kind: "user", id: userId, text: confirm ? `Confirm: ${message}` : message },
      { kind: "assistant", id: turnId, message, mode: askMode, response: null, error: null, resolved: false }]);
    try {
      const response = await api.assistant({ plan_id: planId, message, mode: askMode === "automatic" ? "automatic" : "ask_first", ...(confirm ? { confirm: true } : {}) });
      setTurns((prev) => patchTurn(prev, turnId, { response }));
      // A new plan (re-plan, what-if saved) or a changed one (sent, answered): reload it so every page shows it.
      if (response.plan_id && (response.plan_id !== planId || response.status === "completed")) setPlan(await api.plan(response.plan_id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setTurns((prev) => patchTurn(prev, turnId, { error: msg.startsWith("404") ? "Assistant is not connected yet." : msg }));
    }
  }, [planId, setPlan]);

  const resolve = (turnId: number) => setTurns((prev) => patchTurn(prev, turnId, { resolved: true }));
  const confirmTurn = (turn: AssistantTurn) => { resolve(turn.id); void ask(turn.message, turn.mode, true); };

  async function createPlan() {
    setCreating(true); setCreateError("");
    try {
      const [sid] = await api.scenarios();
      if (!sid) throw new Error("The backend has no scenarios to plan from.");
      setPlan(await api.createPlan({ scenario_id: sid, as_of: "2025-09-29", temp_class: "ambient", weights: { pi_mult: 1 } }));
    } catch (e) { setCreateError(e instanceof Error ? e.message : String(e)); } finally { setCreating(false); }
  }

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !planId) return;
    setDraft("");
    void ask(text, mode);
  };
  const ready = planId !== null;

  return (
    <aside className="assist" aria-label="Assistant">
      <h2 className="assist-head">
        <span className="dot" aria-hidden="true" />
        Assistant
        <small>{plan ? `acts on ${plan.plan_id} v${plan.version}` : "no plan yet"}</small>
      </h2>
      <div className="assist-modes seg" role="group" aria-label="How the assistant acts">
        {MODE_OPTIONS.map((o) => (
          <button key={o.id} type="button" className={mode === o.id ? "on" : ""} aria-pressed={mode === o.id} onClick={() => setMode(o.id)}>{o.label}</button>
        ))}
      </div>
      {mode === "by_hand" && <p className="assist-note">By hand: the assistant suggests but does not act</p>}
      <div className="log" ref={logRef}>
        <div className="msg sys">
          <div className="who">Assistant</div>
          <p>Ask about any order, check status, or tell me what to do. I only quote numbers from this plan.</p>
          {!ready && (
            <div className="confirm-row">
              <button type="button" className="primary small" disabled={creating} onClick={createPlan}>{creating ? "Creating…" : "Create this week's plan"}</button>
            </div>
          )}
          {createError && <p className="reply error">{createError}</p>}
        </div>
        {turns.map((t) => t.kind === "user"
          ? <div key={t.id} className="msg you"><div className="who">You</div><p>{t.text}</p></div>
          : <AssistantMessage key={t.id} turn={t} onConfirm={confirmTurn} onCancel={resolve} />)}
      </div>
      <div className="suggest">
        {QUICK_PROMPTS.map((p) => <button key={p} type="button" disabled={!ready} onClick={() => void ask(p, mode)}>{p}</button>)}
      </div>
      <form className="ask" onSubmit={submit}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={ready ? "Ask, or tell it what to do" : "Create a plan first"} aria-label="Message the assistant" disabled={!ready} />
        <button type="submit" disabled={!ready || draft.trim() === ""}>Send</button>
      </form>
    </aside>
  );
}
