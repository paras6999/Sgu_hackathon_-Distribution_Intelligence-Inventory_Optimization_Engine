"use client";

import { useEffect, useState } from "react";
import type { AssistantResponse, AssistantStep } from "@dia/types";

/** What the working card shows: a response status, or "pending" while the request runs. */
export type WorkOutcome = AssistantResponse["status"] | "pending" | "error";

const PHASES = ["Reading the plan", "Checking orders", "Running the step"];
const PHASE_MS = 1200;
const STEP_STAGGER_MS = 160;
/** How long the finished steps stay open before the card collapses. */
const HOLD_MS = 900;

function headline(outcome: WorkOutcome, stepCount: number, phase: string): string {
  const steps = stepCount === 1 ? "1 step" : `${stepCount} steps`;
  switch (outcome) {
    case "pending":
      return phase;
    case "completed":
      return stepCount > 0 ? `Done · ${steps}` : "Done";
    case "answered":
      return stepCount > 0 ? `Answered · ${steps}` : "Answered";
    case "needs_confirmation":
      return "Waiting for you to confirm";
    default:
      return "Failed";
  }
}

function CheckIcon({ className }: { className: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CrossIcon({ className }: { className: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 4.5l7 7m0-7l-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function DashIcon({ className }: { className: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 8h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function OutcomeMark({ outcome }: { outcome: WorkOutcome }) {
  if (outcome === "pending") return <span className="pulse-dot" aria-hidden="true" />;
  if (outcome === "needs_confirmation") return <span className="wait-dot" aria-hidden="true" />;
  if (outcome === "completed" || outcome === "answered") return <CheckIcon className="icon-ok" />;
  return <CrossIcon className="icon-bad" />;
}

function StepRow({ step, index }: { step: AssistantStep; index: number }) {
  const mark =
    step.status === "done" ? (
      <CheckIcon className="icon-ok" />
    ) : step.status === "failed" ? (
      <CrossIcon className="icon-bad" />
    ) : (
      <DashIcon className="icon-muted" />
    );
  return (
    <li className="step" style={{ animationDelay: `${index * STEP_STAGGER_MS}ms` }}>
      {mark}
      <span>{step.summary}</span>
    </li>
  );
}

/**
 * The assistant's working card. It runs expanded while the request is pending, reveals its
 * steps one by one when the answer arrives, then collapses to a one-line summary.
 */
export function WorkCard({ outcome, steps }: { outcome: WorkOutcome; steps: AssistantStep[] }) {
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
    // Failed answers stay collapsed; the reply is already in the error colour.
    if (pending || failed) return;
    const id = setTimeout(() => setAutoCollapsed(true), steps.length * STEP_STAGGER_MS + HOLD_MS);
    return () => clearTimeout(id);
  }, [pending, failed, steps.length]);

  const expandedByDefault = !failed && !autoCollapsed;
  const open = pending || (canExpand && (toggled ?? expandedByDefault));

  return (
    <div className="work">
      <button
        type="button"
        className="work-head"
        aria-expanded={open}
        disabled={!canExpand}
        onClick={() => setToggled(!open)}
      >
        <OutcomeMark outcome={outcome} />
        <span className={`work-title${failed ? " text-bad" : ""}`}>
          {headline(outcome, steps.length, PHASES[phase])}
        </span>
        {canExpand && <span className="work-toggle">{open ? "Collapse" : "Expand"}</span>}
      </button>
      <div className={`work-body${open ? " open" : ""}`}>
        <div className="work-inner">
          <div className="work-pad">
            {pending ? (
              <div className="progress" />
            ) : (
              <ol className="steps">
                {steps.map((step, i) => (
                  <StepRow key={i} step={step} index={i} />
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
