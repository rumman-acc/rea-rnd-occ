"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { EvidenceNotice } from "@/features/admin/EvidenceNotice";
import { useSession } from "@/state/Session";
import { getReleases, startUpgrade, type Releases, type Upgrade } from "./api";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const PILL = { current: "pill--green", available: "pill--blue", previous: "pill--gray" } as const;

export function ReleasesPage() {
  const { user } = useSession();
  const [data, setData] = useState<Releases | null>(null);
  const [error, setError] = useState("");
  const [last, setLast] = useState<Upgrade | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getReleases().then(setData).catch((e) => setError(msg(e)));
  }, []);
  useEffect(load, [load]);

  const upgrade = async (version: string) => {
    setBusy(true);
    setError("");
    try {
      setLast(await startUpgrade(version, user?.name ?? "demo"));
      load();
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader title="Releases & Upgrades" sub={data ? `Running version v${data.current}` : undefined} />
      <EvidenceNotice />
      <div className="notice notice--warn" role="note">
        Upgrades are simulated. Requesting one records and journals the request and shows progress steps; it does not change any code and the running version stays the same.
      </div>
      {error && <div className="notice notice--bad" role="alert">{error}</div>}
      {last && (
        <Card title={`Upgrade to v${last.version} (simulated)`}>
          <ol data-testid="upgrade-steps">
            {last.steps.map((s) => <li key={s.name}>{s.name}: {s.status}</li>)}
          </ol>
          <p>{last.note}</p>
        </Card>
      )}
      <Card title="Releases">
        {!data && !error && <div className="empty">Loading releases…</div>}
        {data && (
          <div className="table-scroll">
            <table className="dt">
              <thead><tr><th>Version</th><th>Date</th><th>Notes</th><th>Status</th><th>Action</th></tr></thead>
              <tbody>
                {data.releases.map((r) => (
                  <tr key={r.version}>
                    <td>v{r.version}</td><td>{r.date}</td><td>{r.notes}</td>
                    <td><span className={`pill ${PILL[r.status]}`}>{r.status}</span></td>
                    <td>{r.status === "available" && <button className="btn btn--small" disabled={busy} onClick={() => upgrade(r.version)} aria-label={`Simulate upgrade to ${r.version}`}>Simulate upgrade</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data && (
        <Card title="Upgrade requests">
          <div className="table-scroll">
            <table className="dt">
              <thead><tr><th>ID</th><th>From</th><th>To</th><th>Operator</th><th>Requested</th><th>Result</th></tr></thead>
              <tbody>
                {data.upgrades.length === 0 && <tr><td colSpan={6} className="empty">No upgrade requests yet.</td></tr>}
                {data.upgrades.map((u) => (
                  <tr key={u.id}><td>{u.id}</td><td>v{u.from}</td><td>v{u.version}</td><td>{u.operator}</td><td>{u.requestedAt}</td><td>{u.status} (simulated)</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
