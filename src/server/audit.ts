import type { Store } from "./store";
import { nowIso } from "./clock";

// Shared audit journal. Any module can append; the Admin module reads it (SPEC-FULL ARC-F04).

export interface AuditEntry {
  id: number;
  ts: string;
  /** Module that wrote the entry, e.g. "pricing", "warehouse", "ai", "admin". */
  source: string;
  actor: string;
  action: string;
  detail: string;
}

const KEY = "audit:log";

export function appendAudit(store: Store, e: { source: string; actor: string; action: string; detail?: string }): AuditEntry {
  return store.update<AuditEntry[], AuditEntry>(KEY, () => [], (log) => {
    const entry: AuditEntry = {
      id: (log.at(-1)?.id ?? 0) + 1,
      ts: nowIso(),
      source: e.source,
      actor: e.actor,
      action: e.action,
      detail: e.detail ?? "",
    };
    log.push(entry);
    return entry;
  });
}

/** Newest first. `source` filters exactly; `q` is a case-insensitive substring over action/detail/actor. */
export function listAudit(store: Store, opts: { source?: string; q?: string; limit?: number } = {}): AuditEntry[] {
  const q = (opts.q ?? "").trim().toLowerCase();
  const out = store
    .get<AuditEntry[]>(KEY, () => [])
    .filter((e) => (!opts.source || e.source === opts.source) && (!q || `${e.action} ${e.detail} ${e.actor}`.toLowerCase().includes(q)))
    .reverse();
  return opts.limit ? out.slice(0, opts.limit) : out;
}
