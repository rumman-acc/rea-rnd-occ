import { appendAudit } from "@/server/audit";
import { nowIso } from "@/server/clock";
import { badRequest, notFound } from "@/server/http";
import type { Store } from "@/server/store";

// Backups (P). A backup is a deep copy of the whole store taken with store.snapshot(), minus the
// backup bookkeeping itself (keys starting "admin:backup") so backups never nest.

export interface BackupMeta {
  id: string;
  createdAt: string;
  createdBy: string;
  documents: number;
  bytes: number;
}

const LIST_KEY = "admin:backups";
const payloadKey = (id: string) => `admin:backup:${id}`;
const isBackupKey = (k: string) => k.startsWith("admin:backup");

export function listBackups(store: Store): BackupMeta[] {
  return store.get<BackupMeta[]>(LIST_KEY, () => []).slice().reverse();
}

export function createBackup(store: Store, actor: string): BackupMeta {
  const snap = Object.fromEntries(Object.entries(store.snapshot()).filter(([k]) => !isBackupKey(k)));
  const all = store.get<BackupMeta[]>(LIST_KEY, () => []);
  const next = Math.max(0, ...all.map((b) => Number(b.id.slice(4)))) + 1;
  const meta: BackupMeta = {
    id: `bkp-${String(next).padStart(4, "0")}`,
    createdAt: nowIso(),
    createdBy: actor,
    documents: Object.keys(snap).length,
    bytes: JSON.stringify(snap).length,
  };
  store.set(payloadKey(meta.id), snap);
  store.update<BackupMeta[]>(LIST_KEY, () => [], (l) => void l.push(meta));
  appendAudit(store, { source: "admin", actor, action: "backup.create", detail: `${meta.id}: ${meta.documents} documents` });
  return meta;
}

function find(store: Store, id: string): BackupMeta {
  const meta = store.get<BackupMeta[]>(LIST_KEY, () => []).find((b) => b.id === id);
  if (!meta) throw notFound(`Backup ${id} not found`);
  return meta;
}

export function deleteBackup(store: Store, actor: string, id: string): void {
  find(store, id);
  store.update<BackupMeta[]>(LIST_KEY, () => [], (l) => {
    l.splice(l.findIndex((b) => b.id === id), 1);
  });
  // The Store interface has no remove; leave an empty marker in place of the payload.
  store.set(payloadKey(id), {});
  appendAudit(store, { source: "admin", actor, action: "backup.delete", detail: id });
}

/** Replace all data with the backup. Backup bookkeeping survives; the restore itself is journaled afterwards. */
export function restoreBackup(store: Store, actor: string, id: string): BackupMeta {
  const meta = find(store, id);
  const snap = store.get<Record<string, unknown> | null>(payloadKey(id), () => null);
  if (!snap || Object.keys(snap).length === 0) throw badRequest(`Backup ${id} has no data`);
  const keep = Object.fromEntries(Object.entries(store.snapshot()).filter(([k]) => isBackupKey(k)));
  store.restore({ ...snap, ...keep });
  appendAudit(store, { source: "admin", actor, action: "backup.restore", detail: `${id} (taken ${meta.createdAt})` });
  return meta;
}
