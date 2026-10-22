"use client";

import { clock } from "./operator";
import type { FlowRun } from "./types";

export const STEP_KIND: Record<string, string> = {
  TRIGGER: "Trigger",
  GATHER: "Gather",
  ANALYZE: "Analyze",
  THRESHOLD: "Threshold",
  APPROVAL: "Approval",
  EXECUTE: "Execute",
  NOTIFY: "Notify",
};

const RUN_STATUS: Record<string, [string, string]> = {
  completed: ["green", "COMPLETED"],
  awaiting_hitl: ["yellow", "AWAITING HITL"],
  running: ["blue", "RUNNING"],
  failed: ["red", "FAILED — human decision needed"],
  rejected: ["red", "REJECTED"],
};

export function RunStatusPill({ status }: { status: string }) {
  const [tone, label] = RUN_STATUS[status] ?? ["blue", status.toUpperCase()];
  return <span className={`pill pill--${tone}`}>{label}</span>;
}

export function FlowRunView({ run }: { run: FlowRun }) {
  return (
    <div>
      <div className="ai-row ai-meta">
        <span className={`pill pill--${run.mode === "simulate" ? "purple" : "blue"}`}>{run.mode}</span>
        <RunStatusPill status={run.status} />
        <span>
          v{run.flow_version} · started {clock(run.started_at)} by <b>{run.initiated_by || "operator"}</b>
        </span>
        {run.finished_at && <span>· finished {clock(run.finished_at)}</span>}
      </div>
      <div className="ai-strip">
        {run.steps.map((s, i) => (
          <span key={`${s.step_id}-${i}`} className="ai-row">
            <span title={s.detail} className={`ai-chip ai-chip--${s.status}`}>
              <span className="ai-chip__kind">{STEP_KIND[s.type] ?? s.type}</span>
              {s.name}
            </span>
            {i < run.steps.length - 1 && <span className="ai-arrow">→</span>}
          </span>
        ))}
        {run.steps.length === 0 && <span className="ai-muted">no steps executed</span>}
      </div>
      <div className="ai-steplist">
        {run.steps.map((s, i) => (
          <div key={`${s.step_id}-${i}`} className="ai-step">
            <span className="ai-mono ai-muted">{clock(s.started_at)}</span>
            <span className={`ai-dot ai-dot--${s.status}`} />
            <span className="ai-step__name">{s.name}</span>
            <span className="ai-step__detail">{s.detail || "—"}</span>
            {s.actor && s.actor !== "system" && <span className={`pill pill--${s.actor === "simulation" ? "purple" : "blue"}`}>{s.actor}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function FlowRunModal({ run, onClose }: { run: FlowRun; onClose: () => void }) {
  return (
    <div className="ai-modal" role="dialog" aria-label={`Execution — ${run.flow_name}`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ai-modal__box">
        <div className="ai-modal__head">
          <h3>Execution — {run.flow_name}</h3>
          <button className="btn btn--small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <FlowRunView run={run} />
      </div>
    </div>
  );
}
