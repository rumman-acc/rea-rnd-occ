"use client";

import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Card } from "@/components/Card";
import { KpiCard } from "@/components/KpiCard";
import { PageHeader } from "@/components/PageHeader";
import * as api from "./api";
import { ErrorNote, errText, EvidenceNotice, Loading, money, money2, Pill, Table, Tabs, useLoad } from "./ui";

const TABS = ["Overview", "Accounts & Mappings", "Settings", "Jobs", "Run Log", "Audit", "Documents"] as const;
type Tab = (typeof TABS)[number];
const KINDS = ["dunning", "po-approval", "revenue-risk-alert", "month-end-close", "gl-balance-check"];
const SOURCES = ["opening", "sales", "inventory", "purchasing", "expense", "manual"];
const STATUSES = ["open", "acknowledged", "resolved", "dismissed"];

const statusPill = (s: string | null) =>
  s === null ? <span className="pill pill--gray">never run</span> : <span className={s === "ok" ? "pill pill--green" : "pill pill--yellow"}>{s === "ok" ? "OK" : "Attention"}</span>;
const stamp = (ts: string) => ts.slice(0, 19).replace("T", " ");

/** Run an action, report its outcome, then refresh the data. */
function useAction(after: () => Promise<unknown> | void) {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    try {
      const m = await fn();
      setMsg(m ?? null);
      setErr(null);
      await after();
    } catch (e) {
      setMsg(null);
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const note = (
    <>
      {err && <ErrorNote message={err} />}
      {msg && (
        <p className="notice" role="status">
          {msg}
        </p>
      )}
    </>
  );
  return { act, busy, note };
}

function OverviewTab() {
  const o = useLoad(() => api.getOverview(), []);
  const v = useLoad(() => api.getVendors(), []);
  const b = useLoad(() => api.getBankAccounts(), []);
  if (o.error) return <ErrorNote message={o.error} />;
  if (!o.data) return <Loading text="Loading overview…" />;
  const d = o.data;
  return (
    <div className="stack">
      <div className="kpi-grid">
        <KpiCard label="Active Accounts" value={`${d.accounts.active} / ${d.accounts.total}`} sub="chart of accounts" tone="blue" />
        <KpiCard label="Mappings" value={d.mappings} sub="account mappings" tone="blue" />
        <KpiCard label="Enabled Jobs" value={`${d.jobs.enabled} / ${d.jobs.total}`} sub="automation rules" tone="blue" />
        <KpiCard label="Open Findings" value={d.audit.open} sub={`${d.audit.total} audit findings`} tone={d.audit.open > 0 ? "amber" : "green"} />
        <KpiCard label="Log Entries" value={d.log_entries} sub="process log" tone="blue" />
        <KpiCard label="Ledger" value={`${d.ledger.documents} docs`} sub={d.ledger.balanced ? "balanced" : "OUT OF BALANCE"} tone={d.ledger.balanced ? "green" : "red"} />
      </div>
      <div className="grid-2">
        <Card title="Vendors" bodyClassName="card__body--table">
          <Table
            head={["Vendor", "Name", "Lead time", "Open PO lines", "Open PO value", "Mapped account"]}
            numeric={[2, 3, 4]}
            empty="No vendors."
            rows={(v.data ?? []).map((x) => [x.vendor_no, x.name, `${x.lead_time_days} d`, x.open_po_lines, money2(x.open_po_total), x.mapped_account ?? "—"])}
          />
        </Card>
        <Card title="Bank accounts" bodyClassName="card__body--table">
          <Table head={["Account", "Currency", "Ledger account", "Balance"]} numeric={[3]} empty="No bank accounts." rows={(b.data ?? []).map((x) => [x.name, x.currency, x.gl_account_no, money2(x.balance)])} />
        </Card>
      </div>
    </div>
  );
}

function AccountsTab() {
  const [all, setAll] = useState(false);
  const [m, setM] = useState({ kind: "series-account", key: "", value: "4000" });
  const accs = useLoad(() => api.getAccounts(all), [all]);
  const allAccs = useLoad(() => api.getAccounts(true), []);
  const maps = useLoad(() => api.getMappings(), []);
  const { act, busy, note } = useAction(async () => {
    await Promise.all([accs.reload(), allAccs.reload(), maps.reload()]);
  });
  return (
    <div className="stack">
      {note}
      <Card
        title="Chart of accounts"
        bodyClassName="card__body--table"
        actions={
          <span className="toolbar">
            <label>
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show inactive
            </label>
            <button className="btn btn--small" disabled={busy} onClick={() => void act(async () => {
              const r = await api.refreshAccounts();
              return `Accounts refreshed (simulated): ${r.activated} activated, ${r.deactivated} deactivated`;
            })}>
              Refresh accounts (simulated)
            </button>
          </span>
        }
      >
        {accs.error && <ErrorNote message={accs.error} />}
        <Table
          head={["Account", "Name", "Type", "Status", "Postings"]}
          empty="No accounts."
          rows={(accs.data ?? []).map((a) => [a.account_no, a.name, a.type, <Pill key="s" ok={a.active} yes="Active" no="Inactive" />, a.has_postings ? "yes" : "none"])}
        />
      </Card>
      <Card title="Mappings (used by a full ledger sync)" bodyClassName="card__body--table">
        <div className="fin-form">
          <label>
            Kind
            <select className="select" aria-label="Mapping kind" value={m.kind} onChange={(e) => setM({ ...m, kind: e.target.value })}>
              <option value="series-account">series-account (revenue account per series)</option>
              <option value="vendor-account">vendor-account (debit account per vendor)</option>
            </select>
          </label>
          <label>
            Key ({m.kind === "series-account" ? "series, e.g. 3000" : "vendor, e.g. V-100"})
            <input className="input" aria-label="Mapping key" value={m.key} onChange={(e) => setM({ ...m, key: e.target.value })} />
          </label>
          <label>
            Account
            <select className="select" aria-label="Mapping account" value={m.value} onChange={(e) => setM({ ...m, value: e.target.value })}>
              {(allAccs.data ?? []).map((a) => (
                <option key={a.account_no} value={a.account_no}>
                  {a.account_no} {a.name}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn--primary" disabled={busy} onClick={() => void act(async () => {
            const r = await api.addMapping(m.kind, m.key, m.value);
            return `Mapping ${r.id} saved`;
          })}>
            Add mapping
          </button>
        </div>
        <Table
          head={["Id", "Kind", "Key", "Account", ""]}
          empty="No mappings."
          rows={(maps.data ?? []).map((x) => [
            x.id,
            x.kind,
            x.key,
            x.value,
            <button key="d" className="btn btn--small btn--danger" disabled={busy} aria-label={`Delete ${x.id}`} onClick={() => void act(async () => {
              await api.deleteMapping(x.id);
              return `Mapping ${x.id} deleted`;
            })}>
              Delete
            </button>,
          ])}
        />
      </Card>
    </div>
  );
}

function SettingsTab() {
  const s = useLoad(() => api.getSettings(), []);
  const [v, setV] = useState<Record<string, string> | null>(null);
  const { act, busy, note } = useAction(async () => void (await s.reload()));
  if (s.error) return <ErrorNote message={s.error} />;
  if (!s.data) return <Loading text="Loading settings…" />;
  const cur = v ?? { customer: String(s.data.customer_terms_days), vendor: String(s.data.vendor_terms_days), cash: String(s.data.opening_cash) };
  return (
    <Card title="Settings">
      {note}
      <div className="fin-form">
        <label>
          Customer terms (days)
          <input className="input" aria-label="Customer terms (days)" value={cur.customer} onChange={(e) => setV({ ...cur, customer: e.target.value })} />
        </label>
        <label>
          Vendor terms (days)
          <input className="input" aria-label="Vendor terms (days)" value={cur.vendor} onChange={(e) => setV({ ...cur, vendor: e.target.value })} />
        </label>
        <label>
          Opening cash (applies on a full sync)
          <input className="input" aria-label="Opening cash" value={cur.cash} onChange={(e) => setV({ ...cur, cash: e.target.value })} />
        </label>
        <button className="btn btn--primary" disabled={busy} onClick={() => void act(async () => {
          await api.saveSettings({ customer_terms_days: Number(cur.customer), vendor_terms_days: Number(cur.vendor), opening_cash: Number(cur.cash) });
          setV(null);
          return "Settings saved";
        })}>
          Save settings
        </button>
      </div>
    </Card>
  );
}

function JobRow({ job, busy, onSave, onRun, onDelete }: { job: api.Job; busy: boolean; onSave: (j: Partial<api.Job>) => void; onRun: () => void; onDelete: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(job.params).map(([k, x]) => [k, String(x)])));
  return (
    <div className="fin-job" data-testid={`job-${job.id}`}>
      <div className="fin-job__head">
        <strong>{job.name}</strong>
        <span className={job.enabled ? "pill pill--green" : "pill pill--gray"}>{job.enabled ? "Enabled" : "Disabled"}</span>
        <span className="pill pill--blue">{job.schedule}</span>
        <span className="pill pill--purple">{job.kind}</span>
        {statusPill(job.last_status)}
        <span className="fin-job__desc">{job.last_run_at ? `last run ${stamp(job.last_run_at)}` : ""}</span>
      </div>
      <div className="fin-job__desc">{job.description}</div>
      <div className="fin-form">
        {Object.keys(job.params).map((k) => (
          <label key={k}>
            {k}
            <input className="input" aria-label={`${job.id} ${k}`} value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
          </label>
        ))}
        {Object.keys(job.params).length > 0 && (
          <button className="btn btn--small" disabled={busy} aria-label={`Save ${job.name}`} onClick={() => onSave({ id: job.id, params: Object.fromEntries(Object.entries(vals).map(([k, x]) => [k, Number(x)])) })}>
            Save
          </button>
        )}
        <button className="btn btn--small" disabled={busy} aria-label={`${job.enabled ? "Disable" : "Enable"} ${job.name}`} onClick={() => onSave({ id: job.id, enabled: !job.enabled })}>
          {job.enabled ? "Disable" : "Enable"}
        </button>
        <button className="btn btn--small btn--primary" disabled={busy || !job.enabled} aria-label={`Run ${job.name}`} onClick={onRun}>
          Run now
        </button>
        <button className="btn btn--small btn--danger" disabled={busy} aria-label={`Delete ${job.name}`} onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

function JobsTab() {
  const jobs = useLoad(() => api.getJobs(), []);
  const [last, setLast] = useState<api.Run | null>(null);
  const [nj, setNj] = useState({ name: "", kind: "dunning" });
  const { act, busy, note } = useAction(async () => void (await jobs.reload()));
  return (
    <div className="stack">
      {note}
      {jobs.error && <ErrorNote message={jobs.error} />}
      <Card title="Automation jobs (local simulation)" bodyClassName="card__body--table">
        {!jobs.data && jobs.loading && <Loading text="Loading jobs…" />}
        {jobs.data?.map((j) => (
          <JobRow
            key={`${j.id}-${JSON.stringify(j.params)}-${j.enabled}`}
            job={j}
            busy={busy}
            onSave={(x) => void act(async () => {
              await api.saveJob(x);
              return `${j.name} updated`;
            })}
            onRun={() => void act(async () => {
              setLast(await api.runJob(j.id));
            })}
            onDelete={() => void act(async () => {
              await api.deleteJob(j.id);
              return `${j.name} deleted`;
            })}
          />
        ))}
      </Card>
      <Card title="New job">
        <div className="fin-form">
          <label>
            Name
            <input className="input" aria-label="Job name" value={nj.name} onChange={(e) => setNj({ ...nj, name: e.target.value })} />
          </label>
          <label>
            Kind
            <select className="select" aria-label="Job kind" value={nj.kind} onChange={(e) => setNj({ ...nj, kind: e.target.value })}>
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
          </label>
          <button className="btn btn--primary" disabled={busy} onClick={() => void act(async () => {
            const j = await api.saveJob({ name: nj.name, kind: nj.kind, enabled: true });
            setNj({ name: "", kind: nj.kind });
            return `Job ${j.id} created`;
          })}>
            Create job
          </button>
        </div>
      </Card>
      {last && (
        <Card title={`Last run ${last.id}: ${last.job_name}`}>
          <p data-testid="run-panel">
            {statusPill(last.status)} {last.summary} (as of {last.as_of}, simulated)
          </p>
          {last.items.length > 0 && <Table head={["Item", "Amount", "Note"]} numeric={[1]} empty="" rows={last.items.map((i) => [i.label, i.amount === null ? "—" : money2(i.amount), i.note])} />}
        </Card>
      )}
    </div>
  );
}

function LogTab() {
  const [proc, setProc] = useState("");
  const log = useLoad(() => api.getLog(proc || undefined), [proc]);
  return (
    <Card
      title="Process log"
      bodyClassName="card__body--table"
      actions={
        <select className="select" aria-label="Process filter" value={proc} onChange={(e) => setProc(e.target.value)}>
          <option value="">All processes</option>
          {["accounts", "mappings", "settings", "audit", "jobs"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      }
    >
      {log.error && <ErrorNote message={log.error} />}
      {!log.data && log.loading && <Loading text="Loading log…" />}
      {log.data && <Table head={["#", "Time", "Process", "Level", "Operator", "Ref", "Message"]} empty="No log entries yet." rows={log.data.map((e) => [e.id, stamp(e.ts), e.process, e.level, e.operator, e.ref ?? "", e.message])} />}
    </Card>
  );
}

function AuditTab() {
  const [days, setDays] = useState("90");
  const [status, setStatus] = useState("");
  const f = useLoad(() => api.getFindings(status || undefined), [status]);
  const { act, busy, note } = useAction(async () => void (await f.reload()));
  return (
    <div className="stack">
      {note}
      <Card
        title="Audit findings"
        bodyClassName="card__body--table"
        actions={
          <span className="toolbar">
            <select className="select" aria-label="Finding status filter" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <input className="input fin-cell" aria-label="Window days" value={days} onChange={(e) => setDays(e.target.value)} />
            <button className="btn btn--small btn--primary" disabled={busy} onClick={() => void act(async () => {
              const r = await api.runAudit(Number(days));
              return `Audit ${r.run_id}: ${r.scanned_documents} document(s) scanned, ${r.new_findings} new finding(s), ${r.open_findings} open (simulated)`;
            })}>
              Run audit
            </button>
          </span>
        }
      >
        {f.error && <ErrorNote message={f.error} />}
        <Table
          head={["Finding", "Kind", "Severity", "Document", "Account", "Amount", "Message", "Status"]}
          numeric={[5]}
          empty="No findings. Run an audit."
          rows={(f.data ?? []).map((x) => [
            x.id,
            x.kind,
            x.severity,
            x.document_no,
            x.account_no ?? "—",
            money2(x.amount),
            x.message,
            <select key="s" className="select" aria-label={`Status ${x.id}`} value={x.status} disabled={busy} onChange={(e) => void act(async () => {
              await api.patchFinding(x.id, e.target.value, x.note);
              return `${x.id} set to ${e.target.value}`;
            })}>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>,
          ])}
        />
      </Card>
    </div>
  );
}

function DocumentsTab() {
  const [kind, setKind] = useState("sales");
  const [path, setPath] = useState("/");
  const hist = useLoad(() => api.getHistory(kind), [kind]);
  const dir = useLoad(() => api.browse(path), [path]);
  const st = useLoad(() => api.folderStatus(path), [path]);
  const up = path === "/" ? null : "/";
  return (
    <div className="stack">
      <Card
        title="Posting history by kind"
        bodyClassName="card__body--table"
        actions={
          <select className="select" aria-label="History kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            {SOURCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        }
      >
        {hist.error && <ErrorNote message={hist.error} />}
        <Table head={["Date", "Document", "Description", "Amount"]} numeric={[3]} empty="No documents of this kind." rows={(hist.data ?? []).map((d) => [d.posting_date, d.document_no, d.description, money2(d.amount)])} />
      </Card>
      <Card title={`Document folders: ${path}`} bodyClassName="card__body--table">
        <p className="fin-notice notice">Virtual folders over posted ledger documents (read only; the server file system is never accessed).</p>
        {dir.error && <ErrorNote message={dir.error} />}
        {st.data && (
          <p data-testid="folder-status">
            {st.data.files} file(s), {money2(st.data.total_amount)}, last posting {st.data.last_posting_date ?? "—"}
          </p>
        )}
        <Table
          head={["Name", "Type", "Detail"]}
          empty="Empty folder."
          rows={[
            ...(up ? [[<button key="up" className="btn btn--small" onClick={() => setPath(up)}>.. (up)</button>, "folder", ""]] : []),
            ...(dir.data?.entries ?? []).map((e) => [
              e.type === "folder" ? (
                <button key={e.path} className="btn btn--small" onClick={() => setPath(e.path)}>
                  {e.name}/
                </button>
              ) : (
                e.name
              ),
              e.type,
              e.type === "folder" ? `${e.count} file(s)` : `${e.posting_date}, ${money(e.amount ?? 0)}`,
            ]),
          ]}
        />
      </Card>
    </div>
  );
}

/** /finance-ops: Finance Ops & Automation (spec/finance.md). A reconstruction; all processing is a local simulation. */
export function FinanceOps() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [version, setVersion] = useState(0);
  return (
    <div>
      <PageHeader
        title="Finance Ops & Automation"
        sub="Accounts, mappings, jobs, audit and ledger documents (local simulation)"
        actions={
          <button className="btn btn--outline" onClick={() => setVersion((v) => v + 1)}>
            <RefreshCw size={14} /> Refresh
          </button>
        }
      />
      <EvidenceNotice>Reconstruction without original reference: the original page was not captured. Everything here runs as a local simulation; nothing is sent, posted or synced to any external system.</EvidenceNotice>
      <div className="stack" key={version}>
        <Tabs tabs={TABS} value={tab} onChange={setTab} />
        {tab === "Overview" && <OverviewTab />}
        {tab === "Accounts & Mappings" && <AccountsTab />}
        {tab === "Settings" && <SettingsTab />}
        {tab === "Jobs" && <JobsTab />}
        {tab === "Run Log" && <LogTab />}
        {tab === "Audit" && <AuditTab />}
        {tab === "Documents" && <DocumentsTab />}
      </div>
    </div>
  );
}
