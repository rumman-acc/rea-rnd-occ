"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { useSession } from "@/state/Session";
import { EvidenceNotice } from "./EvidenceNotice";
import * as api from "./api";

const TABS = ["Users", "Integrations", "Audit log", "Backups", "Peer instance"] as const;
type Tab = (typeof TABS)[number];

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Loads data on mount and on demand; exposes data, error and reload. */
function useLoad<T>(fn: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(() => {
    fn().then((d) => { setData(d); setError(""); }).catch((e) => setError(msg(e)));
  }, [fn]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}

export function AdminCenter() {
  const [tab, setTab] = useState<Tab>("Users");
  return (
    <div className="stack">
      <PageHeader title="Admin Center" sub="Users, integrations, audit log, backups" />
      <EvidenceNotice simulated="Integrations, the peer instance and backups' restore target are local simulations." />
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab${tab === t ? " tab--active" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Users" && <UsersPanel />}
      {tab === "Integrations" && <IntegrationsPanel />}
      {tab === "Audit log" && <AuditPanel />}
      {tab === "Backups" && <BackupsPanel />}
      {tab === "Peer instance" && <PeerPanel />}
    </div>
  );
}

function Err({ text }: { text: string }) {
  return text ? <div className="notice notice--bad" role="alert">{text}</div> : null;
}

function UsersPanel() {
  const { data, error } = useLoad(api.getUsers);
  return (
    <Card title="Users">
      <Err text={error} />
      {!data && !error && <div className="empty">Loading users…</div>}
      {data && (
        <div className="table-scroll">
          <table className="dt">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.email}><td>{u.name}</td><td>{u.email}</td><td><span className="pill pill--blue">{u.role}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function IntegrationsPanel() {
  const { data, error } = useLoad(api.getIntegrations);
  return (
    <Card title="Integrations">
      <Err text={error} />
      {!data && !error && <div className="empty">Loading integrations…</div>}
      {data && (
        <div className="table-scroll">
          <table className="dt">
            <thead><tr><th>Connector</th><th>Type</th><th>Status</th><th>Details</th></tr></thead>
            <tbody>
              {data.integrations.map((i) => (
                <tr key={i.id}><td>{i.name}</td><td>{i.kind}</td><td><span className="pill pill--yellow">Simulated</span></td><td>{i.detail}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AuditPanel() {
  const [source, setSource] = useState("");
  const [q, setQ] = useState("");
  const fn = useCallback(() => api.getAudit(source, q), [source, q]);
  const { data, error } = useLoad(fn);
  return (
    <Card title="Audit log">
      <div className="toolbar">
        <select className="select" aria-label="Source" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All sources</option>
          {data?.sources.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input className="input" aria-label="Search audit log" placeholder="Search action, detail, actor" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Err text={error} />
      {!data && !error && <div className="empty">Loading audit log…</div>}
      {data && (
        <div className="table-scroll">
          <table className="dt">
            <thead><tr><th>Time</th><th>Source</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
            <tbody>
              {data.entries.length === 0 && <tr><td colSpan={5} className="empty">No audit entries match.</td></tr>}
              {data.entries.map((e) => (
                <tr key={e.id}><td>{e.ts}</td><td>{e.source}</td><td>{e.actor}</td><td>{e.action}</td><td>{e.detail}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function BackupsPanel() {
  const { user } = useSession();
  const { data, error, reload } = useLoad(api.getBackups);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");
  const [fail, setFail] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setFail("");
    try {
      await fn();
      setInfo(label);
      setConfirming(null);
      reload();
    } catch (e) {
      setFail(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Backups" actions={<button className="btn btn--primary btn--small" disabled={busy} onClick={() => run("Backup created.", api.createBackup)}>Create backup</button>}>
      <Err text={error || fail} />
      {info && <div className="notice" role="status">{info}</div>}
      {!data && !error && <div className="empty">Loading backups…</div>}
      {data && (
        <div className="table-scroll">
          <table className="dt">
            <thead><tr><th>ID</th><th>Created</th><th>By</th><th className="num">Documents</th><th className="num">Size (bytes)</th><th>Actions</th></tr></thead>
            <tbody>
              {data.backups.length === 0 && <tr><td colSpan={6} className="empty">No backups yet.</td></tr>}
              {data.backups.map((b) => (
                <tr key={b.id}>
                  <td>{b.id}</td><td>{b.createdAt}</td><td>{b.createdBy}</td><td className="num">{b.documents}</td><td className="num">{b.bytes}</td>
                  <td>
                    {confirming === b.id ? (
                      <span className="toolbar" style={{ margin: 0 }}>
                        <span>Replace all current data with {b.id}?</span>
                        <button className="btn btn--danger btn--small" disabled={busy} onClick={() => run(`Restored ${b.id}.`, () => api.restoreBackup(b.id, user?.name ?? "demo"))}>Confirm restore</button>
                        <button className="btn btn--small" onClick={() => setConfirming(null)}>Cancel</button>
                      </span>
                    ) : (
                      <span className="toolbar" style={{ margin: 0 }}>
                        <button className="btn btn--small" disabled={busy} onClick={() => setConfirming(b.id)} aria-label={`Restore ${b.id}`}>Restore</button>
                        <button className="btn btn--small" disabled={busy} onClick={() => run(`Deleted ${b.id}.`, () => api.deleteBackup(b.id))} aria-label={`Delete ${b.id}`}>Delete</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function PeerPanel() {
  const [peer, setPeer] = useState<api.Peer | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Card title="Peer instance">
      <p>Start a second application instance for side-by-side testing. This is a simulation: no process is started.</p>
      <div className="toolbar">
        <button className="btn btn--primary" disabled={busy} onClick={() => {
          setBusy(true);
          api.startPeer().then((p) => { setPeer(p); setError(""); }).catch((e) => setError(msg(e))).finally(() => setBusy(false));
        }}>Start peer instance</button>
      </div>
      <Err text={error} />
      {peer && (
        <div className="notice" role="status" data-testid="peer-result">
          {peer.id} ({peer.status}) at {peer.url}, started {peer.startedAt}. {peer.note}
        </div>
      )}
    </Card>
  );
}
