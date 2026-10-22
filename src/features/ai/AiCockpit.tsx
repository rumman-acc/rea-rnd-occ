"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { formatShortDate } from "@/domain/format";
import { usePlan } from "@/state/PlanState";
import { aiApi } from "./api";
import { FlowBuilder } from "./FlowBuilder";
import { FlowRunModal, FlowRunView, RunStatusPill } from "./FlowRunView";
import { clock, getOperator, setOperator } from "./operator";
import type { AgentRun, AiConfig, AiSettings, Agent, Ctx, Flow, FlowRun, InboxItem, Persona, Verdict } from "./types";
import "./ai.css";

type Tab = "cockpit" | "modeler" | "history";
const STAGES = [
  { key: "INITIALIZING", label: "Init" },
  { key: "GATHERING_DATA", label: "Gather" },
  { key: "SIMULATING", label: "Simulate" },
  { key: "AWAITING_HITL", label: "HITL" },
];
const ACTIVE = ["INITIALIZING", "GATHERING_DATA", "SIMULATING"];
const CTP_FLOW = "Autonomous CTP Negotiator";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function mailDraft(subject: string, body: string) {
  try {
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  } catch {
    // no mail client
  }
}

export function AiCockpit({ fastPollMs = 2000, slowPollMs = 30000 }: { fastPollMs?: number; slowPollMs?: number }) {
  const [tab, setTab] = useState<Tab>("cockpit");
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [simMode, setSimMode] = useState<boolean | null>(null);
  const [toggling, setToggling] = useState(false);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [plans, setPlans] = useState<InboxItem[]>([]);
  const [flowRuns, setFlowRuns] = useState<FlowRun[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [operator, setOp] = useState("operator");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, i, p, fr, f] = await Promise.all([aiApi.tickRuns(), aiApi.inbox(), aiApi.savedPlans(), aiApi.flowRuns(), aiApi.flows()]);
      setRuns(r);
      setInbox(i);
      setPlans(p);
      setFlowRuns(fr);
      setFlows(f.flows);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  useEffect(() => {
    setOp(getOperator());
    aiApi
      .config()
      .then((c) => {
        setConfig(c);
        setPersona(c.persona);
        setSettings(c.settings);
        setSimMode(c.simulation_mode);
      })
      .catch((e) => setError(errText(e)));
  }, []);

  const fast = useRef(false);
  fast.current = runs.some((r) => !["EXECUTED", "REJECTED", "AWAITING_HITL"].includes(r.status)) || flowRuns.some((r) => r.status === "running");
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      if (!document.hidden) await load();
      if (!stopped) timer = setTimeout(() => void tick(), fast.current ? fastPollMs : slowPollMs);
    };
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, fastPollMs, slowPollMs]);

  const pending = inbox.filter((i) => i.decision === "PENDING");
  const decided = inbox.filter((i) => i.decision !== "PENDING");

  async function toggleMode() {
    setToggling(true);
    try {
      setSimMode((await aiApi.setSimulationMode(!simMode)).simulation_mode);
    } catch (e) {
      setError(errText(e));
    } finally {
      setToggling(false);
    }
  }

  const TABS: [Tab, string][] = [
    ["cockpit", "1 · Command Center"],
    ["modeler", "2 · Process Modeler"],
    ["history", "3 · Agentic History"],
  ];

  return (
    <div>
      <PageHeader
        title="AI & HITL Cockpit"
        sub="Simulated, rule-based agents propose — you approve. Nothing is executed without a human decision."
        actions={
          <>
            <label className="ai-row ai-acting">
              Acting as
              <input
                className="input"
                value={operator}
                title="Human id journaled on every initiation, approval and edit"
                onChange={(e) => {
                  setOp(e.target.value);
                  setOperator(e.target.value);
                }}
              />
            </label>
            {pending.length > 0 && (
              <span className="pill pill--purple">
                {pending.length} decision{pending.length === 1 ? "" : "s"} waiting
              </span>
            )}
            {simMode !== null && (
              <button
                className={`btn ai-mode ${simMode ? "ai-mode--sim" : "ai-mode--live"}`}
                disabled={toggling}
                onClick={() => void toggleMode()}
                title={simMode ? "Simulation ON: approvals are saved as plans; nothing executes" : "LIVE: approvals execute immediately against local master data"}
              >
                {simMode ? "SIMULATION — approvals are saved, nothing executes" : "LIVE — approvals execute against local master data"}
              </button>
            )}
          </>
        }
      />
      <div className="notice ai-gap-b">Agents here are simulated: deterministic, rule-based procedures over this app&apos;s master data. There is no AI model and no external system.</div>
      {error && (
        <div className="notice notice--bad ai-gap-b" role="alert">
          {error}
        </div>
      )}
      <div className="tabs" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`tab${tab === k ? " tab--active" : ""}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === "modeler" && <FlowBuilder operator={operator} onPublished={() => void load()} />}
      {tab === "history" && <AgenticHistory />}
      {tab === "cockpit" && (
        <>
          <Tiles agents={config?.agents ?? []} runs={runs} flows={flows} flowRuns={flowRuns} operator={operator} onChanged={load} onError={setError} />
          <div className="ai-cols">
            <div className="stack">
              <Telemetry runs={runs} />
              <Inbox pending={pending} decided={decided} simMode={!!simMode} operator={operator} onChanged={load} />
              <SavedPlans plans={plans} onChanged={load} />
            </div>
            <div>{persona && settings && <PersonaBuilder persona={persona} settings={settings} onSaved={(p, s) => { setPersona(p); setSettings(s); }} />}</div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------- tiles ----------

function Tiles({ agents, runs, flows, flowRuns, operator, onChanged, onError }: { agents: Agent[]; runs: AgentRun[]; flows: Flow[]; flowRuns: FlowRun[]; operator: string; onChanged: () => Promise<void>; onError: (e: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<FlowRun | null>(null);
  const hasCtp = agents.some((a) => a.name === "ctp_negotiator");
  const published = flows.filter((f) => f.status === "published" && !(hasCtp && f.name === CTP_FLOW));

  async function act(key: string, fn: () => Promise<unknown>, quiet409 = false) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      if (!(quiet409 && errText(e).includes("409"))) onError(errText(e));
    } finally {
      await onChanged();
      setBusy(null);
    }
  }

  return (
    <div className="ai-tiles">
      {agents.map((a) => {
        const run = runs.find((r) => r.agent_name === a.name);
        const active = !!run && ACTIVE.includes(run.status);
        const paused = active && !!run?.paused;
        return (
          <Card key={a.name} title={a.label}>
            <div className="ai-tile" data-testid={`agent-${a.name}`}>
              <div className="ai-grow">
                <div className="ai-clip" title={a.objective}>{a.objective}</div>
                {run && <StatusPill status={run.status} paused={paused} />}
                {run?.notice && <div className="ai-note">{run.notice}</div>}
                {run && <div className="ai-muted">{run.current_message}</div>}
              </div>
              {active && run ? (
                <div className="ai-col">
                  <button className="btn btn--small" disabled={busy === run.run_id} onClick={() => void act(run.run_id, () => aiApi.controlRun(run.run_id, paused ? "resume" : "pause", operator), true)}>
                    {paused ? "Resume" : "Pause"}
                  </button>
                  <button className="btn btn--small btn--danger" disabled={busy === run.run_id} onClick={() => void act(run.run_id, () => aiApi.controlRun(run.run_id, "cancel", operator), true)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button className="btn btn--small ai-purple" disabled={busy === a.name} onClick={() => void act(a.name, () => aiApi.runAgent(a.name, operator))}>
                  Run
                </button>
              )}
            </div>
          </Card>
        );
      })}
      {published.map((f) => {
        const r = flowRuns.find((x) => x.flow_id === f.id && x.mode === "live");
        const blocked = !!r && ["running", "awaiting_hitl"].includes(r.status);
        const last = r?.steps.at(-1);
        return (
          <Card key={f.id} title={f.name}>
            <div className="ai-tile" data-testid={`flow-${f.id}`}>
              <div className="ai-grow">
                <div className="ai-clip" title={f.description}>
                  {f.description || "modeled flow"} · v{f.version}
                </div>
                <div className="ai-row">
                  {r && <RunStatusPill status={r.status} />}
                  {r && (
                    <button className="ai-link" onClick={() => setView(r)}>
                      execution view
                    </button>
                  )}
                </div>
                {last && <div className="ai-muted">{last.detail}</div>}
              </div>
              <button className="btn btn--small ai-purple" disabled={busy === f.id || blocked} onClick={() => void act(f.id, () => aiApi.runFlow(f.id, operator))}>
                Run
              </button>
            </div>
          </Card>
        );
      })}
      {view && <FlowRunModal run={flowRuns.find((x) => x.id === view.id) ?? view} onClose={() => setView(null)} />}
    </div>
  );
}

function StatusPill({ status, paused }: { status: string; paused?: boolean }) {
  if (paused) return <span className="pill pill--yellow">PAUSED</span>;
  const tone = status === "EXECUTED" ? "green" : status === "REJECTED" ? "red" : status === "AWAITING_HITL" ? "purple" : "blue";
  return <span className={`pill pill--${tone}`}>{status.replaceAll("_", " ")}</span>;
}

// ---------- telemetry ----------

function Telemetry({ runs }: { runs: AgentRun[] }) {
  const log = useRef<HTMLDivElement>(null);
  const shown = runs.slice(0, 3);
  const events = useMemo(
    () => runs.flatMap((r) => r.steps.map((s) => ({ at: s.at, agent: r.agent_name, message: s.message, status: s.status }))).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).slice(-30),
    [runs],
  );
  useEffect(() => {
    const el = log.current;
    if (el && typeof el.scrollTo === "function") el.scrollTo({ top: el.scrollHeight });
  }, [events.length]);
  return (
    <Card title="Live Agent Telemetry" bodyClassName="ai-nopad">
      {shown.length === 0 ? (
        <p className="ai-pad ai-muted">No agent runs yet — launch an agent above and watch its thought process stream here.</p>
      ) : (
        <div className="ai-pad stack">
          {shown.map((r) => (
            <RunProgress key={r.run_id} run={r} />
          ))}
        </div>
      )}
      {events.length > 0 && (
        <div ref={log} className="ai-log" data-testid="telemetry-log">
          {events.map((e, i) => (
            <div key={i} className={`ai-log--${e.status}`}>
              <span className="ai-log__t">[{clock(e.at)}]</span> <span className="ai-log__a">{e.agent}:</span> {e.message}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function RunProgress({ run }: { run: AgentRun }) {
  const finished = run.status === "EXECUTED" || run.status === "REJECTED";
  const idx = finished ? STAGES.length : STAGES.findIndex((s) => s.key === run.status);
  return (
    <div className="ai-run">
      <div className="ai-row">
        <b>{run.agent_name}</b>
        <StatusPill status={run.status} paused={!finished && run.paused} />
        <span className="ai-spacer" />
        <span className="ai-muted">started {clock(run.started_at)}</span>
      </div>
      <div className="ai-row ai-stages">
        {STAGES.map((s, i) => (
          <span key={s.key} className={`ai-stage${i < idx ? " ai-stage--done" : i === idx && !finished ? " ai-stage--now" : ""}`}>
            {s.label}
          </span>
        ))}
        <span className={`ai-stage${run.status === "EXECUTED" ? " ai-stage--ok" : run.status === "REJECTED" ? " ai-stage--bad" : ""}`}>{run.status === "REJECTED" ? "Rejected" : "Done"}</span>
      </div>
      <div className="ai-bar">
        <div style={{ width: `${run.progress_pct}%` }} />
      </div>
      <div className="ai-muted">{run.current_message}</div>
    </div>
  );
}

// ---------- inbox ----------

const confidence = (c: number) => {
  const t = Math.round(c * 100);
  return { tone: t > 90 ? "green" : t > 70 ? "yellow" : "red", label: `${t}% confidence` };
};

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="ai-kv__l">{label}</div>
      <div className="ai-mono ai-kv__v">{value}</div>
    </div>
  );
}

function SimTable({ sim }: { sim?: Ctx }) {
  if (!sim?.before || !sim?.after) return null;
  const fmt = (v: unknown, k: string) => (v == null ? "—" : k === "buffer_days" ? `${Number(v) > 0 ? "+" : ""}${v}d` : k === "start" || k === "end" ? formatShortDate(String(v)) : String(v));
  const rows: [string, string][] = [["Start", "start"], ["End", "end"], ["Buffer vs promise", "buffer_days"], ["Health", "health"], ["Capacity-overloaded days", "capacity_overloaded_days"]];
  return (
    <table className="dt">
      <thead>
        <tr>
          <th />
          <th>Before</th>
          <th>After (simulated)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([l, k]) => (
          <tr key={k}>
            <td>{l}</td>
            <td className="ai-mono">{fmt(sim.before[k], k)}</td>
            <td className="ai-mono">
              <b>{fmt(sim.after[k], k)}</b>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PoLogic({ ctx }: { ctx: Ctx }) {
  const sim = ctx.simulation;
  const rs = ctx.risk_sizing;
  return (
    <div className="ai-kvgrid">
      {sim && (
        <>
          <Kv label="First stockout" value={formatShortDate(String(sim.first_stockout ?? ""))} />
          <Kv label="Projected trough" value={Number(sim.projected_trough ?? 0).toLocaleString("en-US", { maximumFractionDigits: 1 })} />
          <Kv label="Vendor on-time" value={sim.vendor_on_time_pct != null ? `${sim.vendor_on_time_pct}%` : "no history"} />
        </>
      )}
      {rs && (
        <>
          <Kv label="Net need" value={String(rs.net_need)} />
          <Kv label="Risk inflation" value={`×${rs.inflation_factor}`} />
          <Kv label="Final qty (MOQ/multiple)" value={String(rs.final_qty)} />
        </>
      )}
    </div>
  );
}

function Inbox({ pending, decided, simMode, operator, onChanged }: { pending: InboxItem[]; decided: InboxItem[]; simMode: boolean; operator: string; onChanged: () => Promise<void> }) {
  const [showHistory, setShowHistory] = useState(false);
  // Items decided in this session stay on screen (with their outcome) until the page is left.
  const [recent, setRecent] = useState<string[]>([]);
  const cards = [...pending, ...decided.filter((d) => recent.includes(d.id))].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  return (
    <Card
      title={`HITL Action Inbox (${pending.length} pending)`}
      actions={
        decided.length > 0 && (
          <button className="ai-link" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? "hide" : "show"} history ({decided.length})
          </button>
        )
      }
    >
      {pending.length === 0 && <p className="ai-muted">Inbox zero — agents have nothing awaiting your judgment.</p>}
      <div className="stack">
        {cards.map((i) => (
          <InboxCard key={i.id} item={i} simMode={simMode} operator={operator} onDecided={async () => { setRecent((r) => (r.includes(i.id) ? r : [...r, i.id])); await onChanged(); }} />
        ))}
      </div>
      {showHistory && decided.length > 0 && (
        <div className="ai-history">
          {decided.slice(0, 10).map((e) => (
            <div key={e.id} className="ai-row ai-wrap ai-hist">
              <span className={`pill pill--${e.decision === "APPROVED" ? "green" : "red"}`}>{e.decision}</span>
              <b>{e.title}</b>
              {typeof e.execution_result?.bc_po_number === "string" && <span className="pill pill--blue">PO {e.execution_result.bc_po_number}</span>}
              {typeof e.execution_result?.error === "string" && <span className="pill pill--red">execution failed</span>}
              {e.decision_note && <span className="ai-muted">“{e.decision_note}”</span>}
              <span className="ai-spacer" />
              <span className="ai-muted">
                {e.decided_at ? formatShortDate(e.decided_at) : ""} {e.decided_at ? clock(e.decided_at) : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function InboxCard({ item, simMode, operator, onDecided }: { item: InboxItem; simMode: boolean; operator: string; onDecided: () => Promise<void> }) {
  const plan = usePlan();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<InboxItem | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const email = item.context_data.email as { subject: string; body: string; to_vendor_name: string } | undefined;
  const [subject, setSubject] = useState(email?.subject ?? "");
  const [body, setBody] = useState(email?.body ?? "");
  const conf = confidence(item.ai_confidence_score);
  const isFlow = item.action_type === "FLOW_APPROVAL";
  const ctx = item.context_data;

  async function decide(d: "APPROVED" | "REJECTED") {
    setBusy(d);
    setErr(null);
    try {
      const edited = email && (subject !== email.subject || body !== email.body);
      const out = await aiApi.decide(item.id, d, note, d === "APPROVED" && edited ? { email: { subject, body } } : {}, operator);
      setResult(out);
      if (d === "APPROVED" && !simMode) {
        if (item.action_type === "RESCHEDULE_PROD_ORDER" && ctx.payload) {
          plan.setSimMode(true);
          await plan.addSimOverride({ po_number: ctx.payload.po_number, new_start: ctx.payload.new_start, new_end: ctx.payload.new_end });
        }
        if (item.action_type === "EMAIL_SUPPLIER") mailDraft(subject, body);
      }
      await onDecided();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }

  const er = result?.execution_result;
  return (
    <div className="ai-item" data-testid={`inbox-${item.id}`}>
      <div className="ai-item__head ai-row ai-wrap">
        <b>{item.title}</b>
        <span className={`pill pill--${conf.tone}`}>{conf.label}</span>
        {ctx.expedite === true && <span className="pill pill--red">EXPEDITE</span>}
        <span className="ai-spacer" />
        <span className="ai-muted">
          {item.agent_name} · {clock(item.created_at)}
        </span>
      </div>
      <div className="ai-item__body">
        <p>{item.recommended_action}</p>
        <button className="ai-link" aria-expanded={open} onClick={() => setOpen(!open)}>
          View AI Logic / Simulation {open ? "▲" : "▼"}
        </button>
        {open && (
          <div className="ai-logic">
            {typeof ctx.why === "string" && <p>{ctx.why}</p>}
            {item.action_type === "RESCHEDULE_PROD_ORDER" && <SimTable sim={ctx.simulation} />}
            {item.action_type === "CREATE_PO" && <PoLogic ctx={ctx} />}
            {item.action_type === "EMAIL_SUPPLIER" && ctx.overdue_lines && (
              <div className="ai-muted">
                {ctx.overdue_lines.length} overdue line(s): {ctx.overdue_lines.map((l: Ctx) => `${l.po_number}/${l.item_no} (${l.days_late}d)`).join(" · ")}
              </div>
            )}
            {isFlow && ctx.proposal && (
              <div className="ai-kvgrid">
                {Object.entries(ctx.proposal as Ctx)
                  .filter(([, v]) => ["string", "number"].includes(typeof v))
                  .slice(0, 9)
                  .map(([k, v]) => (
                    <Kv key={k} label={k.replaceAll("_", " ")} value={String(v)} />
                  ))}
              </div>
            )}
          </div>
        )}
        {email && !result && (
          <div className="ai-email">
            <div className="ai-kv__l">Drafted email to {email.to_vendor_name} — edit before approving</div>
            <input className="input ai-wide" aria-label="Email subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <textarea className="textarea ai-mono" aria-label="Email body" rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
        )}
        {result ? (
          <div className="ai-outcome">
            {result.decision === "APPROVED" ? (
              <span className="ai-row ai-wrap">
                <span className="pill pill--green">APPROVED</span>
                {isFlow && "Flow resumed — follow it in the tile's execution view or the Agentic History tab."}
                {er?.simulated === true && "Saved as an agentic plan — validate & execute it from “Saved Agentic Plans” below."}
                {typeof er?.bc_po_number === "string" && (
                  <>
                    Draft PO <b className="ai-mono">{er.bc_po_number}</b> created in the local vendor PO table (simulated; no Business Central).
                  </>
                )}
                {er?.applied === "app_simulation" && "New dates applied to the app-wide simulation — review on Schedule & Simulate."}
                {er?.delivery === "manual" && "Draft handed to your email client."}
                {typeof er?.error === "string" && <span className="ai-bad">Execution failed: {er.error}</span>}
              </span>
            ) : (
              <span className="ai-row">
                <span className="pill pill--red">REJECTED</span> Feedback recorded for the audit trail.
              </span>
            )}
          </div>
        ) : (
          <div className="ai-row ai-wrap ai-decide">
            <button className={`btn btn--small ${simMode && !isFlow ? "ai-purple" : "btn--green"}`} disabled={busy !== null} onClick={() => void decide("APPROVED")}>
              {isFlow ? "Approve & Continue Flow" : simMode ? "Approve & Save Plan (simulation)" : "Approve & Execute"}
            </button>
            <button className="btn btn--small btn--danger" disabled={busy !== null} onClick={() => void decide("REJECTED")}>
              Reject & Modify
            </button>
            <input className="input ai-grow" aria-label="Decision note" placeholder="Note / what to change (kept in the audit trail)" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
        {err && <p className="ai-bad">{err}</p>}
      </div>
    </div>
  );
}

// ---------- saved plans ----------

function SavedPlans({ plans, onChanged }: { plans: InboxItem[]; onChanged: () => Promise<void> }) {
  return (
    <Card title={`Saved Agentic Plans (${plans.length})`} actions={<span className="pill pill--purple">simulation approvals — validate against fresh master data before executing</span>}>
      {plans.length === 0 ? (
        <p className="ai-muted">No saved plans. Approvals made while Simulation Mode is ON are captured here for later validation & execution.</p>
      ) : (
        <div className="stack">
          {plans.map((p) => (
            <PlanCard key={p.id} item={p} onChanged={onChanged} />
          ))}
        </div>
      )}
    </Card>
  );
}

function PlanCard({ item, onChanged }: { item: InboxItem; onChanged: () => Promise<void> }) {
  const plan = usePlan();
  const [busy, setBusy] = useState<string | null>(null);
  const [rv, setRv] = useState<Verdict | null>((item.context_data.revalidation as Verdict | undefined) ?? null);
  const [err, setErr] = useState<string | null>(null);
  const badge = rv && (rv.verdict === "still_valid" ? <span className="pill pill--green">STILL VALID</span> : rv.verdict === "changed" ? <span className="pill pill--yellow">CHANGED — review</span> : <span className="pill pill--red">OBSOLETE</span>);

  async function run(kind: string, fn: () => Promise<void>) {
    setBusy(kind);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(null);
    }
  }
  const execute = () =>
    run("execute", async () => {
      const out = await aiApi.executePlan(item.id);
      const er = out.execution_result;
      if (item.action_type === "RESCHEDULE_PROD_ORDER" && item.context_data.payload) {
        const p = item.context_data.payload;
        plan.setSimMode(true);
        await plan.addSimOverride({ po_number: p.po_number, new_start: p.new_start, new_end: p.new_end });
      }
      if (item.action_type === "EMAIL_SUPPLIER" && item.context_data.email) mailDraft(item.context_data.email.subject, item.context_data.email.body);
      if (typeof er?.error === "string") setErr(`Execution failed: ${er.error}`);
      await onChanged();
    });

  return (
    <div className="ai-item ai-plan" data-testid={`plan-${item.id}`}>
      <div className="ai-row ai-wrap">
        <b>{item.title}</b>
        {badge}
        <span className="ai-spacer" />
        <span className="ai-muted">
          saved {formatShortDate(item.created_at)} {clock(item.created_at)}
        </span>
      </div>
      <p className="ai-muted">{item.recommended_action}</p>
      {rv && (
        <div className={`ai-valid ai-valid--${rv.verdict}`}>
          <b>Validated {clock(rv.checked_at)} on refreshed master data:</b> {rv.summary}
        </div>
      )}
      {err && <p className="ai-bad">{err}</p>}
      <div className="ai-row ai-wrap ai-decide">
        <button className="btn btn--small" disabled={busy !== null} onClick={() => void run("validate", async () => setRv(await aiApi.validatePlan(item.id)))}>
          Refresh & Validate
        </button>
        <button className="btn btn--small btn--green" disabled={busy !== null || !rv || rv.verdict === "obsolete"} onClick={() => void execute()}>
          Execute now
        </button>
        <button className="btn btn--small btn--danger" disabled={busy !== null} onClick={() => void run("discard", async () => { await aiApi.discardPlan(item.id, rv?.summary ?? ""); await onChanged(); })}>
          Discard
        </button>
        {!rv && <span className="ai-muted">validation required before execution</span>}
      </div>
    </div>
  );
}

// ---------- persona ----------

const LEVELS = ["Junior Expediter", "Senior Planner", "VP of Supply Chain"];
const STYLES = ["Direct/Brief", "Diplomatic", "Data-Heavy"];
const MARKETS = ["standard", "disrupted", "critical"];
const PAD = { standard: "×1.0", disrupted: "×1.25", critical: "×1.5" } as Record<string, string>;

function PersonaBuilder({ persona, settings, onSaved }: { persona: Persona; settings: AiSettings; onSaved: (p: Persona, s: AiSettings) => void }) {
  const [p, setP] = useState(persona);
  const [s, setS] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = JSON.stringify(p) !== JSON.stringify(persona) || JSON.stringify(s) !== JSON.stringify(settings);
  const pct = Math.round(p.risk_tolerance * 100);
  const desc = pct <= 25 ? "extremely conservative — builds safety stock, orders early" : pct <= 50 ? "balanced with a safety bias" : pct <= 75 ? "lean-leaning — modest buffers" : "aggressive lean / JIT — exact MOQ, no padding";

  return (
    <Card title="AI Persona Builder">
      <label className="field">
        <span className="ai-row">
          <span>Risk tolerance</span>
          <span className="ai-spacer" />
          <b className="ai-mono">{pct}%</b>
        </span>
        <input type="range" min={0} max={100} value={pct} aria-label="Risk tolerance" onChange={(e) => setP({ ...p, risk_tolerance: Number(e.target.value) / 100 })} />
      </label>
      <div className="ai-row ai-muted ai-gap-b">
        <span>Conservative · safety stock</span>
        <span className="ai-spacer" />
        <span>Aggressive · lean/JIT</span>
      </div>
      <div className="ai-kv__l">Experience level</div>
      <div className="ai-col ai-gap-b">
        {LEVELS.map((l) => (
          <button key={l} className={`ai-opt${p.experience_level === l ? " ai-opt--on" : ""}`} aria-pressed={p.experience_level === l} onClick={() => setP({ ...p, experience_level: l })}>
            {l}
          </button>
        ))}
      </div>
      <div className="ai-kv__l">Communication style</div>
      <div className="ai-row ai-gap-b">
        {STYLES.map((l) => (
          <button key={l} className={`ai-opt ai-grow${p.communication_style === l ? " ai-opt--on" : ""}`} aria-pressed={p.communication_style === l} onClick={() => setP({ ...p, communication_style: l })}>
            {l}
          </button>
        ))}
      </div>
      <div className="ai-kv__l">Global variables</div>
      <label className="field">
        Supply market risk
        <select className="select" value={s.supply_market_risk_factor} onChange={(e) => setS({ ...s, supply_market_risk_factor: e.target.value })}>
          {MARKETS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="field ai-gap-b">
        Fulfillment contingency buffer (days)
        <input className="input" type="number" min={0} max={60} value={s.fulfillment_contingency_buffer_days} onChange={(e) => setS({ ...s, fulfillment_contingency_buffer_days: Math.max(0, Math.min(60, Number(e.target.value))) })} />
      </label>
      <div className="ai-summary">
        <div className="ai-summary__h">Persona summary</div>
        <p>
          A <b>{p.experience_level}</b> who communicates in a <b>{p.communication_style}</b> manner and plans <b>{desc}</b> ({pct}% risk tolerance).
        </p>
        <p>
          Market condition <b>{s.supply_market_risk_factor}</b> (lead-time padding {PAD[s.supply_market_risk_factor]}) · <b>+{s.fulfillment_contingency_buffer_days}d</b> delivery contingency on every reschedule.
        </p>
      </div>
      {err && <p className="ai-bad">{err}</p>}
      {dirty && (
        <button
          className="btn btn--green ai-wide"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setErr(null);
            try {
              const [np, ns] = await Promise.all([aiApi.putPersona(p), aiApi.putSettings(s)]);
              onSaved(np, ns);
              setP(np);
              setS(ns);
            } catch (e) {
              setErr(errText(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          Save persona — applies to the next agent run
        </button>
      )}
    </Card>
  );
}

// ---------- history ----------

function AgenticHistory() {
  const [runs, setRuns] = useState<FlowRun[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRuns(await aiApi.flowRuns());
      setErr(null);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);
  const approvers = (r: FlowRun) => [...new Set(r.steps.map((s) => s.actor).filter((a) => a && !["system", "simulation"].includes(a)))];
  return (
    <Card
      title={`Agentic History (${runs.length} runs)`}
      actions={
        <button className="btn btn--small" disabled={loading} onClick={() => void load()}>
          Refresh
        </button>
      }
    >
      {err && <p className="ai-bad">{err}</p>}
      {runs.length === 0 && <p className="ai-muted">No flow executions yet — simulate or run a flow.</p>}
      <div className="stack">
        {runs.map((r) => (
          <div key={r.id} className="ai-item">
            <button className="ai-histrow ai-row ai-wrap" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
              <b>{r.flow_name}</b>
              <span className="ai-muted">v{r.flow_version}</span>
              <span className={`pill pill--${r.mode === "simulate" ? "purple" : "blue"}`}>{r.mode}</span>
              <RunStatusPill status={r.status} />
              <span className="ai-muted">
                {formatShortDate(r.started_at)} {clock(r.started_at)} · initiated by <b>{r.initiated_by || "operator"}</b>
              </span>
              {approvers(r).length > 0 && <span className="ai-muted">· approvals: {approvers(r).join(", ")}</span>}
              <span className="ai-spacer" />
              <span className="ai-muted">{r.steps.length} step(s)</span>
            </button>
            {open === r.id && (
              <div className="ai-pad">
                <FlowRunView run={r} />
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
