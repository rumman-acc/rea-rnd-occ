"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Card } from "@/components/Card";
import type { PricingConfig } from "./config";
import { partyName, partyNo, type AuditRun, type Finding, type Job } from "./types";
import { csvCell, download, errText, fmtInt, fmtMoney, Modal, Notice, Pill, Th, useOperator, useTable } from "./ui";

const JOB_TYPES: { v: Job["job_type"]; label: (c: PricingConfig) => string; hint: string }[] = [
  { v: "inbox", label: () => "Watch price-file folder", hint: "Simulated: picks up price files dropped in a folder. No filesystem is read in this rebuild." },
  { v: "audit", label: (c) => c.auditJobLabel, hint: "Runs the rule-based auditor over the chosen window." },
  { v: "sync", label: () => "Sync external pricing app", hint: "Simulated: stages the demo list from the external pricing app for review." },
  { v: "pull_bc", label: () => "Pull prices from Business Central", hint: "Simulated: imports the simulated BC price lines into the book (BC wins on conflicts)." },
];

/** Tab "Pricing Auditor": deterministic rule-based findings, review actions and scheduled agents. */
export function AuditorView({ config, header }: { config: PricingConfig; header: ReactNode }) {
  const op = useOperator();
  const api = config.api;
  const k = config.party;
  const [findings, setFindings] = useState<Finding[]>([]);
  const [run, setRun] = useState<AuditRun | null>(null);
  const [status, setStatus] = useState("open");
  const [win, setWin] = useState(180);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);

  const load = useCallback(async () => {
    try {
      const a = await api.audit(status || undefined);
      setFindings(a.findings);
      setRun(a.last_run);
      setJobs(await api.jobs());
    } catch (e) {
      setErr(errText(e));
    }
  }, [api, status]);
  useEffect(() => {
    void load();
  }, [load]);

  const t = useTable<Finding>(findings, {
    sev: { get: (f) => f.severity },
    kind: { get: (f) => f.kind },
    check: { get: (f) => f.check_id },
    title: { get: (f) => f.title },
    impact: { get: (f) => f.impact, numeric: true },
    seen: { get: (f) => f.last_seen },
    st: { get: (f) => f.status },
  });
  const s = run?.summary;

  async function setSt(f: Finding, st: string, note = "") {
    setErr("");
    try {
      await api.patchFinding(f.fingerprint, op, st, note);
      await load();
    } catch (e) {
      setErr(errText(e));
    }
  }

  return (
    <>
      {header}
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="toolbar">
        <label className="pw-small">
          Window{" "}
          <select className="select" value={win} onChange={(e) => setWin(Number(e.target.value))} aria-label="Audit window">
            {[30, 90, 180, 365, 730].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
        </label>
        <button
          className="btn btn--primary" disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr("");
            try {
              await api.auditRun(op, win);
              await load();
            } catch (e) {
              setErr(errText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Auditing…" : "Run pricing audit"}
        </button>
        <label className="pw-small">
          Show{" "}
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Finding status">
            <option value="">all findings</option>
            <option value="open">open</option>
            <option value="reviewed">reviewed</option>
            <option value="dismissed">dismissed</option>
            <option value="resolved">resolved</option>
          </select>
        </label>
        {run && <span className="pw-small">last run {run.ts.replace("T", " ")} by {run.operator}: {fmtInt(s?.priced_lines ?? 0)} priced lines across {fmtInt(s?.documents_scanned ?? 0)} documents</span>}
        <span className="toolbar__spacer" />
        <button
          className="btn"
          onClick={() =>
            download("pricing-audit.csv", [
              `Severity,Kind,Check,Finding,Impact,Status,FirstSeen,LastSeen,${config.partyLabel},Documents,Items`,
              ...t.view.map((f) => [f.severity, f.kind, f.check_id, csvCell(f.title), f.impact, f.status, f.first_seen, f.last_seen, partyNo(f.detail, k), csvCell((f.detail.documents ?? []).join(" ")), csvCell((f.detail.items ?? []).join(" "))].join(",")),
            ])
          }
        >
          Export CSV
        </button>
      </div>
      <Notice tone="warn">
        The auditor is a deterministic rule-based checker over the demo book and demo documents (fixed rules PA-01 to PA-08). It is not an AI model and its findings are not the original system's.
      </Notice>
      <div style={{ height: 12 }} />
      {s && (
        <Card title={`${config.auditorTitle}: ${s.rating.toUpperCase()}`}>
          <p>{s.narrative}</p>
          <ul style={{ margin: "8px 0", paddingLeft: 20 }}>
            {s.recommendations.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          <div className="toolbar" style={{ margin: 0 }}>
            <Pill tone="red">{s.counts.high ?? 0} high</Pill>
            <Pill tone="yellow">{s.counts.medium ?? 0} medium</Pill>
            <Pill tone="gray">{s.counts.low ?? 0} low</Pill>
            {s.risk_impact > 0 && <Pill tone="navy">{fmtMoney(s.risk_impact)} at stake</Pill>}
          </div>
        </Card>
      )}
      <div style={{ height: 16 }} />
      <Card title="Findings" bodyClassName="pw-flush">
        <div className="table-scroll">
          <table className="dt pw-dt">
            <thead>
              <tr>
                <Th t={t} id="sev" label="Severity" />
                <Th t={t} id="kind" label="Type" />
                <Th t={t} id="check" label="Check" />
                <Th t={t} id="title" label="Finding" />
                <Th t={t} id="impact" label="At stake" right />
                <Th t={t} id="seen" label="Last seen" />
                <Th t={t} id="st" label="Status" />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {t.view.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted" style={{ textAlign: "center", padding: 28 }}>
                    No findings{status ? ` with status '${status}'` : ""}. Run the pricing audit to review documents against the price book.
                  </td>
                </tr>
              )}
              {t.view.map((f) => (
                <tr key={f.fingerprint}>
                  <td><Pill tone={f.severity === "high" ? "red" : f.severity === "medium" ? "yellow" : "gray"}>{f.severity}</Pill></td>
                  <td><Pill tone={f.kind === "opportunity" ? "purple" : "blue"}>{f.kind}</Pill></td>
                  <td className="nowrap pw-small">{f.check_id}</td>
                  <td style={{ minWidth: 300 }}>
                    {f.title}
                    <div className="pw-small">
                      {partyName(f.detail, k) && <Pill tone="gray">{partyName(f.detail, k)}</Pill>} {(f.detail.documents ?? []).map((d) => <Pill key={d} tone="gray">{d}</Pill>)}
                    </div>
                    {f.note && <div className="pw-small"><i>note: {f.note}</i></div>}
                  </td>
                  <td className="num pw-mono">{f.impact ? fmtMoney(f.impact) : "—"}</td>
                  <td className="nowrap">{f.last_seen.slice(0, 10)}</td>
                  <td><Pill tone={f.status === "open" ? "blue" : f.status === "resolved" ? "green" : "gray"}>{f.status}</Pill></td>
                  <td>
                    <div className="toolbar" style={{ margin: 0, gap: 4 }}>
                      {f.status !== "reviewed" && <button className="pw-mini" onClick={() => setSt(f, "reviewed")}>mark reviewed</button>}
                      {f.status !== "dismissed" && (
                        <button
                          className="pw-mini"
                          onClick={() => {
                            const note = window.prompt("Why is this acceptable / a false positive?") ?? "";
                            if (note) void setSt(f, "dismissed", note);
                          }}
                        >
                          dismiss
                        </button>
                      )}
                      {f.status !== "open" && <button className="pw-mini" onClick={() => setSt(f, "open")}>reopen</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div style={{ height: 16 }} />
      <Jobs config={config} jobs={jobs} onChanged={load} />
    </>
  );
}

function schedText(j: Job) {
  const s = j.schedule;
  return s.frequency === "hourly" ? `every ${s.every_hours ?? 1}h` : s.frequency === "weekly" ? `weekly ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][s.weekday ?? 0]} ${s.time ?? ""}` : `daily ${s.time ?? ""}`;
}

function Jobs({ config, jobs, onChanged }: { config: PricingConfig; jobs: Job[]; onChanged: () => Promise<void> }) {
  const op = useOperator();
  const [edit, setEdit] = useState<Job | null>(null);
  const [err, setErr] = useState("");
  const t = useTable<Job>(jobs, {
    name: { get: (j) => j.name },
    type: { get: (j) => JOB_TYPES.find((x) => x.v === j.job_type)?.label(config) ?? j.job_type },
    sched: { get: schedText },
    last: { get: (j) => j.last_run ?? "" },
    result: { get: (j) => String(j.last_result?.status ?? "") },
    on: { get: (j) => (j.enabled ? "on" : "off") },
  });
  const act = async (fn: () => Promise<unknown>) => {
    setErr("");
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setErr(errText(e));
    }
  };
  return (
    <Card
      title={config.jobsTitle}
      bodyClassName="pw-flush"
      actions={<button className="btn btn--primary" onClick={() => setEdit({ name: "", job_type: "audit", enabled: true, schedule: { frequency: "daily", time: "06:00" }, criteria: { window_days: 180 } })}>New agent job</button>}
    >
      <div className="strong pw-small" style={{ padding: "8px 16px" }}>Run now executes the agent once, locally and deterministically (simulated); schedules are not triggered automatically.</div>
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="table-scroll">
        <table className="dt pw-dt">
          <thead>
            <tr>
              <Th t={t} id="name" label="Job" />
              <Th t={t} id="type" label="Type" />
              <Th t={t} id="sched" label="Schedule" />
              <Th t={t} id="last" label="Last run" />
              <Th t={t} id="result" label="Last result" />
              <Th t={t} id="on" label="Enabled" />
              <th />
            </tr>
          </thead>
          <tbody>
            {t.view.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>No pricing agents yet. Schedule an audit sweep or an external-app sync.</td></tr>
            )}
            {t.view.map((j) => (
              <tr key={j.id}>
                <td className="strong">{j.name || "(unnamed)"}</td>
                <td>{JOB_TYPES.find((x) => x.v === j.job_type)?.label(config)}</td>
                <td className="pw-small">{schedText(j)}</td>
                <td className="nowrap">{j.last_run?.replace("T", " ") ?? "never"}</td>
                <td>
                  {j.last_result?.status ? (
                    <Pill tone={j.last_result.status === "ok" ? "green" : "red"}>
                      {j.last_result.status}
                      {j.last_result.findings != null && ` · ${j.last_result.findings} findings`}
                      {j.last_result.files != null && ` · ${j.last_result.files} file(s)`}
                    </Pill>
                  ) : "—"}
                  {j.last_result?.error && <div className="pw-small pw-down">{j.last_result.error}</div>}
                </td>
                <td><Pill tone={j.enabled ? "green" : "gray"}>{j.enabled ? "on" : "off"}</Pill></td>
                <td>
                  <div className="toolbar" style={{ margin: 0, gap: 6 }}>
                    <button className="pw-link" aria-label={`Run ${j.name || j.id} now`} onClick={() => act(() => config.api.runJob(j.id!, op))}>run now</button>
                    <button className="pw-link" aria-label={`Edit ${j.name || j.id}`} onClick={() => setEdit(j)}>edit</button>
                    <button className="pw-link" aria-label={`Delete ${j.name || j.id}`} onClick={() => act(() => config.api.deleteJob(j.id!))}>delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <JobDialog config={config} job={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await onChanged(); }} />}
    </Card>
  );
}

function JobDialog({ config, job, onClose, onSaved }: { config: PricingConfig; job: Job; onClose: () => void; onSaved: () => Promise<void> }) {
  const op = useOperator();
  const [m, setM] = useState<Job>(job);
  const [err, setErr] = useState("");
  const hint = JOB_TYPES.find((x) => x.v === m.job_type)?.hint;
  return (
    <Modal
      title={m.id ? "Edit pricing agent" : "New pricing agent"}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn--primary"
            onClick={async () => {
              try {
                await config.api.saveJob(op, m);
                await onSaved();
              } catch (e) {
                setErr(errText(e));
              }
            }}
          >
            Save job
          </button>
        </>
      }
    >
      <div className="pw-form">
        <label className="field">
          Name
          <input className="input" value={m.name} placeholder="e.g. Nightly audit sweep" onChange={(e) => setM({ ...m, name: e.target.value })} />
        </label>
        <label className="field">
          Type
          <select className="select" value={m.job_type} onChange={(e) => setM({ ...m, job_type: e.target.value as Job["job_type"], criteria: e.target.value === "audit" ? { window_days: 180 } : {} })}>
            {JOB_TYPES.map((x) => <option key={x.v} value={x.v}>{x.label(config)}</option>)}
          </select>
          <span className="pw-small">{hint}</span>
        </label>
        <div className="pw-row2">
          <label className="field">
            Frequency
            <select className="select" value={m.schedule.frequency} onChange={(e) => setM({ ...m, schedule: { ...m.schedule, frequency: e.target.value as Job["schedule"]["frequency"] } })}>
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
              <option value="hourly">hourly</option>
            </select>
          </label>
          {m.schedule.frequency !== "hourly" && (
            <label className="field">
              Time
              <input className="input" type="time" value={m.schedule.time ?? "06:00"} onChange={(e) => setM({ ...m, schedule: { ...m.schedule, time: e.target.value } })} />
            </label>
          )}
          {m.schedule.frequency === "hourly" && (
            <label className="field">
              Every N hours
              <input className="input" type="number" min={1} max={24} value={m.schedule.every_hours ?? 1} onChange={(e) => setM({ ...m, schedule: { ...m.schedule, every_hours: Number(e.target.value) } })} />
            </label>
          )}
        </div>
        {m.job_type === "audit" && (
          <label className="field">
            Audit window (days)
            <input className="input" type="number" min={30} max={730} value={Number(m.criteria.window_days ?? 180)} onChange={(e) => setM({ ...m, criteria: { ...m.criteria, window_days: Number(e.target.value) } })} />
          </label>
        )}
        <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={m.enabled} onChange={(e) => setM({ ...m, enabled: e.target.checked })} />
          Enabled
        </label>
        {err && <p className="pw-down strong">{err}</p>}
      </div>
    </Modal>
  );
}
