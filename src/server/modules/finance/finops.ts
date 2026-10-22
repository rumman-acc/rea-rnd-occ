import { appendAudit } from "@/server/audit";
import { nowIso, todayIsoDate } from "@/server/clock";
import { badRequest, conflict, notFound } from "@/server/http";
import { master } from "@/server/master";
import type { Store } from "@/server/store";
import { dashboard as operational, round2 } from "./calc";
import { addDays, isIsoDate } from "./dates";
import { K_MAPPINGS, SOURCES, accounts, glLines, netByAccount, readMappings, type Mapping, type Source } from "./gl";
import { trialBalance } from "./reports";
import { getSettings } from "./settings";

// Finance Ops: simulated, local-only workflows (spec/finance.md section 6).
// Request shapes follow the original client; every rule and response here is our own design.

const operatorOf = (operator: unknown, actor: string) => (typeof operator === "string" && operator.trim() ? operator.trim() : actor);
const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });

// ---- process log ----

export interface LogEntry {
  id: number;
  ts: string;
  process: string;
  level: "info" | "warn";
  operator: string;
  message: string;
  ref: string | null;
  details: unknown;
}
const K_LOG = "finops:log";
export const PROCESSES = ["accounts", "mappings", "settings", "audit", "jobs"] as const;

function log(store: Store, process: (typeof PROCESSES)[number], operator: string, message: string, extra: { level?: "info" | "warn"; ref?: string; details?: unknown } = {}) {
  store.update<LogEntry[]>(K_LOG, () => [], (l) => {
    l.push({ id: (l.at(-1)?.id ?? 0) + 1, ts: nowIso(), process, level: extra.level ?? "info", operator, message, ref: extra.ref ?? null, details: extra.details ?? null });
  });
}

export function listLog(store: Store, limitQ: string | null, process: string | null) {
  const limit = limitQ === null ? 200 : Number(limitQ);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw badRequest("limit must be an integer from 1 to 1000");
  if (process && !(PROCESSES as readonly string[]).includes(process)) throw badRequest(`process must be one of ${PROCESSES.join(", ")}`);
  const entries = store.get<LogEntry[]>(K_LOG, () => []).filter((e) => !process || e.process === process).reverse().slice(0, limit);
  return { entries };
}

// ---- accounts and mappings ----

export function listAccounts(store: Store, all: boolean) {
  const used = new Set(glLines(store).map((l) => l.account_no));
  return { accounts: accounts(store).filter((a) => all || a.active).map((a) => ({ ...a, has_postings: used.has(a.account_no) })) };
}

export { refreshAccounts } from "./gl";
export const logRefresh = (store: Store, operator: string, detail: string) => log(store, "accounts", operator, detail);

export const MAPPING_KINDS = ["series-account", "vendor-account"] as const;

export function listMappings(store: Store, kind: string | null) {
  if (kind && !(MAPPING_KINDS as readonly string[]).includes(kind)) throw badRequest(`kind must be one of ${MAPPING_KINDS.join(", ")}`);
  return { mappings: readMappings(store).filter((m) => !kind || m.kind === kind) };
}

export function putMapping(store: Store, b: { operator?: unknown; kind?: unknown; key?: unknown; value?: unknown }, actor: string): Mapping {
  const operator = operatorOf(b.operator, actor);
  if (typeof b.kind !== "string" || !(MAPPING_KINDS as readonly string[]).includes(b.kind)) throw badRequest(`kind must be one of ${MAPPING_KINDS.join(", ")}`);
  if (typeof b.key !== "string" || !b.key.trim()) throw badRequest("key is required");
  const key = b.key.trim();
  if (b.kind === "vendor-account" && !master(store, "vendors").some((v) => v.id === key)) throw badRequest(`Unknown vendor: ${key}`);
  if (b.kind === "series-account" && !master(store, "fg_items").some((i) => i.series === key)) throw badRequest(`Unknown series: ${key}`);
  const acc = typeof b.value === "string" ? accounts(store).find((a) => a.account_no === b.value) : undefined;
  if (!acc) throw badRequest("value must be an existing account number");
  if (b.kind === "series-account" && acc.type !== "revenue") throw badRequest("series-account must map to a revenue account");
  if (b.kind === "vendor-account" && acc.type !== "asset" && acc.type !== "expense") throw badRequest("vendor-account must map to an asset or expense account");
  const out = store.update<Mapping[], Mapping>(K_MAPPINGS, () => [], (list) => {
    let m = list.find((x) => x.kind === b.kind && x.key === key);
    if (!m) {
      const n = Math.max(0, ...list.map((x) => Number(x.id.slice(2)))) + 1;
      m = { id: `M-${String(n).padStart(4, "0")}`, kind: b.kind as string, key, value: acc.account_no, updated_by: operator, updated_at: nowIso() };
      list.push(m);
    }
    m.value = acc.account_no;
    m.updated_by = operator;
    m.updated_at = nowIso();
    return m;
  });
  log(store, "mappings", operator, `${out.kind} ${out.key} -> ${out.value}`, { ref: out.id });
  appendAudit(store, { source: "finance", actor: operator, action: "mapping.put", detail: `${out.id} ${out.kind} ${out.key} -> ${out.value}` });
  return out;
}

export function deleteMapping(store: Store, id: string, actor: string) {
  const gone = store.update<Mapping[], Mapping | undefined>(K_MAPPINGS, () => [], (list) => {
    const i = list.findIndex((m) => m.id === id);
    return i < 0 ? undefined : list.splice(i, 1)[0];
  });
  if (!gone) throw notFound(`Unknown mapping: ${id}`);
  log(store, "mappings", actor, `deleted ${gone.kind} ${gone.key}`, { ref: id });
  appendAudit(store, { source: "finance", actor, action: "mapping.delete", detail: id });
  return { ok: true };
}

export function putSettings(store: Store, values: unknown, operator: string) {
  log(store, "settings", operator, `updated ${Object.keys((values ?? {}) as object).join(", ") || "nothing"}`);
}

// ---- audit ----

export type FindingStatus = "open" | "acknowledged" | "resolved" | "dismissed";
const STATUSES: FindingStatus[] = ["open", "acknowledged", "resolved", "dismissed"];
export interface Finding {
  id: string;
  run_id: string;
  kind: "unbalanced-document" | "inactive-account" | "duplicate-posting" | "future-dated";
  severity: "high" | "medium" | "low";
  document_no: string;
  account_no: string | null;
  amount: number;
  message: string;
  status: FindingStatus;
  note: string;
  created_at: string;
  updated_by: string | null;
  updated_at: string | null;
}
const K_FINDINGS = "finops:findings";
const findings = (store: Store) => store.get<Finding[]>(K_FINDINGS, () => []);

export function runAudit(store: Store, b: { operator?: unknown; window_days?: unknown }, actor: string) {
  const operator = operatorOf(b.operator, actor);
  const days = b.window_days === undefined ? 90 : b.window_days;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 3650) throw badRequest("window_days must be an integer from 1 to 3650");
  const today = todayIsoDate();
  const from = addDays(today, -days);
  const accs = new Map(accounts(store).map((a) => [a.account_no, a]));
  const inWindow = glLines(store).filter((l) => l.posting_date >= from);
  const byDoc = new Map<string, typeof inWindow>();
  for (const l of inWindow) byDoc.set(l.document_no, [...(byDoc.get(l.document_no) ?? []), l]);
  const found: Omit<Finding, "id" | "run_id" | "status" | "note" | "created_at" | "updated_by" | "updated_at">[] = [];
  const seen = new Map<string, string>();
  for (const [doc, ls] of [...byDoc.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const d = round2(ls.reduce((s, l) => s + l.debit, 0));
    const c = round2(ls.reduce((s, l) => s + l.credit, 0));
    if (d !== c) found.push({ kind: "unbalanced-document", severity: "high", document_no: doc, account_no: null, amount: round2(Math.abs(d - c)), message: `Debits ${d} and credits ${c} differ` });
    if (ls[0].posting_date > today) found.push({ kind: "future-dated", severity: "low", document_no: doc, account_no: null, amount: d, message: `Posting date ${ls[0].posting_date} is in the future` });
    for (const l of ls) {
      if (accs.get(l.account_no)?.active === false) found.push({ kind: "inactive-account", severity: "medium", document_no: doc, account_no: l.account_no, amount: l.debit || l.credit, message: `Posted to inactive account ${l.account_no} ${accs.get(l.account_no)?.name}` });
      const sig = `${l.account_no}|${l.posting_date}|${l.debit}|${l.credit}|${l.description}`;
      const prev = seen.get(sig);
      if (prev && prev !== doc) found.push({ kind: "duplicate-posting", severity: "medium", document_no: doc, account_no: l.account_no, amount: l.debit || l.credit, message: `Same posting as ${prev}` });
      seen.set(sig, doc);
    }
  }
  const runId = `AUD-${String(new Set(findings(store).map((f) => f.run_id)).size + 1).padStart(4, "0")}`;
  let added = 0;
  store.update<Finding[]>(K_FINDINGS, () => [], (list) => {
    for (const f of found) {
      if (list.some((x) => x.kind === f.kind && x.document_no === f.document_no && x.account_no === f.account_no)) continue;
      const n = Math.max(0, ...list.map((x) => Number(x.id.slice(2)))) + 1;
      list.push({ ...f, id: `F-${String(n).padStart(4, "0")}`, run_id: runId, status: "open", note: "", created_at: nowIso(), updated_by: null, updated_at: null });
      added++;
    }
  });
  const result = { run_id: runId, window_days: days, from, to: today, scanned_documents: byDoc.size, scanned_lines: inWindow.length, new_findings: added, open_findings: findings(store).filter((f) => f.status === "open").length };
  log(store, "audit", operator, `audit window ${days}d: ${added} new finding(s), ${result.open_findings} open (simulated)`, { ref: runId, level: added ? "warn" : "info", details: result });
  appendAudit(store, { source: "finance", actor: operator, action: "audit.run", detail: `${runId}: ${added} new` });
  return result;
}

export function listFindings(store: Store, status: string | null) {
  if (status && !STATUSES.includes(status as FindingStatus)) throw badRequest(`status must be one of ${STATUSES.join(", ")}`);
  return { findings: findings(store).filter((f) => !status || f.status === status) };
}

export function patchFinding(store: Store, id: string, b: { operator?: unknown; status?: unknown; note?: unknown }, actor: string): Finding {
  if (!STATUSES.includes(b.status as FindingStatus)) throw badRequest(`status must be one of ${STATUSES.join(", ")}`);
  if (b.note !== undefined && typeof b.note !== "string") throw badRequest("note must be a string");
  const operator = operatorOf(b.operator, actor);
  const out = store.update<Finding[], Finding | undefined>(K_FINDINGS, () => [], (list) => {
    const f = list.find((x) => x.id === id);
    if (!f) return undefined;
    f.status = b.status as FindingStatus;
    if (typeof b.note === "string") f.note = b.note.slice(0, 500);
    f.updated_by = operator;
    f.updated_at = nowIso();
    return f;
  });
  if (!out) throw notFound(`Unknown finding: ${id}`);
  log(store, "audit", operator, `${id} set to ${out.status}`, { ref: id });
  appendAudit(store, { source: "finance", actor: operator, action: "audit.patch", detail: `${id} -> ${out.status}` });
  return out;
}

// ---- jobs ----

export type JobKind = "dunning" | "po-approval" | "revenue-risk-alert" | "month-end-close" | "gl-balance-check";
export type RunStatus = "ok" | "attention";
export interface Job {
  id: string;
  name: string;
  description: string;
  kind: JobKind;
  enabled: boolean;
  schedule: string;
  params: Record<string, number>;
  last_run_at: string | null;
  last_status: RunStatus | null;
}
export interface RunItem {
  label: string;
  amount: number | null;
  note: string;
}
export interface Run {
  id: string;
  job_id: string;
  job_name: string;
  ts: string;
  as_of: string;
  operator: string;
  status: RunStatus;
  summary: string;
  items: RunItem[];
  simulated: true;
}

const K_JOBS = "finops:jobs";
const KINDS: Record<JobKind, { description: string; defaults: Record<string, number>; ranges: Record<string, [number, number]> }> = {
  dunning: { description: "Draft reminders for customers with overdue receivables.", defaults: { min_days_overdue: 1, min_amount: 0 }, ranges: { min_days_overdue: [0, 365], min_amount: [0, 1e9] } },
  "po-approval": { description: "Flag open vendor POs above a value threshold for approval; the rest are auto-approved.", defaults: { threshold: 500 }, ranges: { threshold: [0, 1e9] } },
  "revenue-risk-alert": { description: "Flag when revenue at risk exceeds a share of open order value.", defaults: { threshold_pct: 50 }, ranges: { threshold_pct: [0, 100] } },
  "month-end-close": { description: "Checks the ledger is balanced, no audit findings are open and nothing is overdue (simulated close).", defaults: {}, ranges: {} },
  "gl-balance-check": { description: "Checks that total debits equal total credits in the ledger.", defaults: {}, ranges: {} },
};
const SCHEDULES = ["Manual", "Daily", "Weekly", "Monthly"];

const mk = (id: string, name: string, kind: JobKind, enabled: boolean): Job => ({ id, name, description: KINDS[kind].description, kind, enabled, schedule: "Manual", params: { ...KINDS[kind].defaults }, last_run_at: null, last_status: null });
const seedJobs = (): Job[] => [
  mk("dunning", "Dunning reminders", "dunning", true),
  mk("po-approval", "PO approval thresholds", "po-approval", true),
  mk("revenue-risk-alert", "Revenue-at-risk alert", "revenue-risk-alert", false),
  mk("month-end-close", "Month-end close", "month-end-close", false),
  mk("gl-balance-check", "Ledger balance check", "gl-balance-check", true),
];
export const listJobs = (store: Store): Job[] => store.get(K_JOBS, seedJobs);

function applyParams(kind: JobKind, base: Record<string, number>, input: unknown): Record<string, number> {
  if (input === undefined) return base;
  if (typeof input !== "object" || input === null || Array.isArray(input)) throw badRequest("job.params must be an object");
  const out = { ...base };
  for (const [k, v] of Object.entries(input)) {
    const r = KINDS[kind].ranges[k];
    if (!r) throw badRequest(`Unknown parameter for ${kind}: ${k}`);
    if (typeof v !== "number" || !Number.isFinite(v) || v < r[0] || v > r[1]) throw badRequest(`${k} is out of range`);
    out[k] = v;
  }
  return out;
}

/** PUT /api/finops/jobs: body { operator, job }. Creates the job when `job.id` is absent or unknown; otherwise updates it. */
export function saveJob(store: Store, b: { operator?: unknown; job?: unknown }, actor: string): Job {
  const operator = operatorOf(b.operator, actor);
  const j = b.job as Partial<Job> | undefined;
  if (typeof j !== "object" || j === null) throw badRequest("job is required");
  if (j.enabled !== undefined && typeof j.enabled !== "boolean") throw badRequest("job.enabled must be a boolean");
  if (j.schedule !== undefined && !SCHEDULES.includes(j.schedule)) throw badRequest(`job.schedule must be one of ${SCHEDULES.join(", ")}`);
  if (j.id !== undefined && (typeof j.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(j.id))) throw badRequest("job.id must be lowercase letters, digits and dashes");
  if (j.name !== undefined && (typeof j.name !== "string" || !j.name.trim() || j.name.length > 80)) throw badRequest("job.name must be 1-80 characters");
  const saved = store.update<Job[], Job>(K_JOBS, seedJobs, (jobs) => {
    const existing = j.id ? jobs.find((x) => x.id === j.id) : undefined;
    if (existing) {
      if (j.kind !== undefined && j.kind !== existing.kind) throw badRequest("job.kind cannot be changed");
      existing.params = applyParams(existing.kind, existing.params, j.params);
      if (j.name !== undefined) existing.name = j.name.trim();
      if (j.enabled !== undefined) existing.enabled = j.enabled;
      if (j.schedule !== undefined) existing.schedule = j.schedule;
      return existing;
    }
    if (!j.kind || !(j.kind in KINDS)) throw badRequest(`job.kind must be one of ${Object.keys(KINDS).join(", ")}`);
    if (!j.name) throw badRequest("job.name is required");
    const id = j.id ?? `job-${Math.max(0, ...jobs.map((x) => Number(/^job-(\d+)$/.exec(x.id)?.[1] ?? 0))) + 1}`;
    const job = mk(id, j.name.trim(), j.kind, j.enabled ?? false);
    job.params = applyParams(j.kind, job.params, j.params);
    if (j.schedule) job.schedule = j.schedule;
    jobs.push(job);
    return job;
  });
  appendAudit(store, { source: "finance", actor: operator, action: "job.save", detail: `${saved.id}: enabled=${saved.enabled} params=${JSON.stringify(saved.params)}` });
  return saved;
}

export function deleteJob(store: Store, id: string, actor: string) {
  const gone = store.update<Job[], boolean>(K_JOBS, seedJobs, (jobs) => {
    const i = jobs.findIndex((j) => j.id === id);
    if (i >= 0) jobs.splice(i, 1);
    return i >= 0;
  });
  if (!gone) throw notFound(`Unknown job: ${id}`);
  appendAudit(store, { source: "finance", actor, action: "job.delete", detail: id });
  return { ok: true };
}

export function runJob(store: Store, id: string, b: { operator?: unknown; as_of?: unknown }, actor: string): Run {
  const job = listJobs(store).find((j) => j.id === id);
  if (!job) throw notFound(`Unknown job: ${id}`);
  if (!job.enabled) throw conflict(`Job "${job.name}" is disabled`);
  let asOf = todayIsoDate();
  if (b.as_of !== undefined) {
    if (typeof b.as_of !== "string" || !isIsoDate(b.as_of)) throw badRequest("as_of must be a valid date in YYYY-MM-DD format");
    asOf = b.as_of;
  }
  const operator = operatorOf(b.operator, actor);
  const runNo = store.get<LogEntry[]>(K_LOG, () => []).filter((e) => e.process === "jobs").length + 1;
  const runId = `RUN-${String(runNo).padStart(4, "0")}`;
  const data = operational(store, asOf);
  const items: RunItem[] = [];
  let status: RunStatus = "ok";
  let summary = "";
  const journal = (action: string, detail: string) => appendAudit(store, { source: "finance", actor: operator, action, detail });

  if (job.kind === "dunning") {
    const by = new Map<string, { name: string; amount: number; sos: string[]; max: number }>();
    for (const l of data.receivables.lines) {
      if (l.days_overdue < Math.max(1, job.params.min_days_overdue) || l.amount < job.params.min_amount) continue;
      const g = by.get(l.customer_id) ?? { name: l.customer_name, amount: 0, sos: [], max: 0 };
      g.amount += l.amount;
      g.sos.push(l.so_number);
      g.max = Math.max(g.max, l.days_overdue);
      by.set(l.customer_id, g);
    }
    for (const g of [...by.values()].sort((a, c) => a.name.localeCompare(c.name))) {
      const level = g.max < 30 ? 1 : g.max < 60 ? 2 : 3;
      items.push({ label: `${g.name}: level ${level}`, amount: round2(g.amount), note: `${g.sos.join(", ")}; max ${g.max} days overdue` });
      journal("dunning.reminder", `${g.name} level ${level} ${money(g.amount)} (simulated)`);
    }
    status = items.length ? "attention" : "ok";
    summary = `${items.length} reminder(s) drafted for ${money(items.reduce((s, i) => s + (i.amount ?? 0), 0))} (simulated; none sent)`;
  } else if (job.kind === "po-approval") {
    const groups = new Map<string, number>();
    for (const l of data.payables.lines) groups.set(l.po_number, (groups.get(l.po_number) ?? 0) + l.amount);
    let flagged = 0;
    for (const [po, total] of [...groups.entries()].sort(([a], [c]) => a.localeCompare(c))) {
      const over = total > job.params.threshold;
      if (over) flagged++;
      items.push({ label: po, amount: round2(total), note: over ? "needs approval" : "auto-approved" });
    }
    status = flagged ? "attention" : "ok";
    summary = `${groups.size} PO(s) checked against ${money(job.params.threshold)}; ${flagged} need approval (simulated; no approval workflow)`;
  } else if (job.kind === "revenue-risk-alert") {
    const r = data.risk;
    status = r.pct_of_open > job.params.threshold_pct ? "attention" : "ok";
    items.push({ label: "Revenue at risk", amount: r.total, note: `${r.pct_of_open}% of open order value (threshold ${job.params.threshold_pct}%)` });
    summary = status === "attention" ? `Alert: ${r.pct_of_open}% exceeds ${job.params.threshold_pct}%` : `${r.pct_of_open}% is within ${job.params.threshold_pct}%`;
    journal("risk.alert", summary);
  } else {
    const lines = glLines(store);
    const dates = lines.map((l) => l.posting_date).sort();
    const tb = trialBalance(store, dates[0] ?? asOf, dates.at(-1) ?? asOf);
    const checks: [string, boolean, string][] = [["Trial balance is balanced", tb.balanced, `debits ${tb.totals.debit}, credits ${tb.totals.credit}`]];
    if (job.kind === "month-end-close") {
      const open = findings(store).filter((f) => f.status === "open").length;
      const overdue = data.kpis.overdue_receivables;
      checks.push(["No open audit findings", open === 0, `${open} open`], ["No overdue receivables", overdue === 0, money(overdue)]);
    }
    for (const [label, ok, note] of checks) items.push({ label, amount: null, note: `${ok ? "pass" : "FAIL"}: ${note}` });
    status = checks.every((c) => c[1]) ? "ok" : "attention";
    summary = job.kind === "month-end-close" ? (status === "ok" ? "Period close completed (simulated)" : "Period close blocked: " + checks.filter((c) => !c[1]).map((c) => c[0]).join("; ")) : status === "ok" ? "Ledger is balanced" : "Ledger is NOT balanced";
    if (job.kind === "month-end-close" && status === "ok") journal("period.close", summary);
  }

  const run: Run = { id: runId, job_id: job.id, job_name: job.name, ts: nowIso(), as_of: asOf, operator, status, summary, items, simulated: true };
  store.update<Job[]>(K_JOBS, seedJobs, (jobs) => {
    const x = jobs.find((y) => y.id === id)!;
    x.last_run_at = run.ts;
    x.last_status = status;
  });
  log(store, "jobs", operator, `${job.name}: ${summary}`, { ref: runId, level: status === "ok" ? "info" : "warn", details: run });
  journal("job.run", `${runId} ${job.name}: ${summary}`);
  return run;
}

// ---- vendors, banks, history, browse ----

export function listVendors(store: Store) {
  const maps = readMappings(store);
  const comps = master(store, "components");
  const lines = master(store, "vendor_po_lines").filter((l) => l.status === "Open");
  return {
    vendors: master(store, "vendors").map((v) => {
      const mine = lines.filter((l) => l.vendor_id === v.id);
      return {
        vendor_no: v.id,
        name: v.name,
        lead_time_days: v.lead_time_days,
        open_po_lines: mine.length,
        open_po_total: round2(mine.reduce((s, l) => s + l.quantity * (comps.find((c) => c.item_no === l.component_item_no)?.unit_cost ?? 0), 0)),
        mapped_account: maps.find((m) => m.kind === "vendor-account" && m.key === v.id)?.value ?? null,
      };
    }),
  };
}

export function listBankAccounts(store: Store) {
  const t = netByAccount(store, {}).get("1000");
  return { accounts: [{ id: "BA-01", name: "Operating account", currency: "USD", gl_account_no: "1000", balance: round2((t?.debit ?? 0) - (t?.credit ?? 0)) }] };
}

function docsOf(store: Store, source: Source) {
  const by = new Map<string, { document_no: string; posting_date: string; description: string; amount: number }>();
  for (const l of glLines(store)) {
    if (l.source !== source) continue;
    const d = by.get(l.document_no) ?? { document_no: l.document_no, posting_date: l.posting_date, description: l.description, amount: 0 };
    d.amount = round2(d.amount + l.debit);
    by.set(l.document_no, d);
  }
  return [...by.values()].sort((a, b) => b.posting_date.localeCompare(a.posting_date) || a.document_no.localeCompare(b.document_no));
}

export function history(store: Store, kind: string | null) {
  if (!kind || !SOURCES.includes(kind as Source)) throw badRequest(`kind must be one of ${SOURCES.join(", ")}`);
  return { kind, documents: docsOf(store, kind as Source) };
}

/** Virtual folders: one per ledger source, one file per posted document. Never touches the real file system. */
function folderOf(path: string | null): Source | "" {
  const p = (path ?? "").replace(/^\/+|\/+$/g, "");
  if (p === "") return "";
  if (SOURCES.includes(p as Source)) return p as Source;
  throw notFound(`No such folder: /${p}`);
}

export function browse(store: Store, path: string | null) {
  const f = folderOf(path);
  if (f === "") {
    return { path: "/", entries: SOURCES.map((s) => ({ name: s, type: "folder" as const, path: `/${s}`, count: docsOf(store, s).length })) };
  }
  return { path: `/${f}`, entries: docsOf(store, f).map((d) => ({ name: `${d.document_no}.json`, type: "file" as const, path: `/${f}/${d.document_no}.json`, amount: d.amount, posting_date: d.posting_date })) };
}

export function folderStatus(store: Store, path: string | null) {
  const f = folderOf(path);
  const docs = f === "" ? SOURCES.flatMap((s) => docsOf(store, s)) : docsOf(store, f);
  return {
    path: f === "" ? "/" : `/${f}`,
    exists: true,
    files: docs.length,
    total_amount: round2(docs.reduce((s, d) => s + d.amount, 0)),
    last_posting_date: docs.map((d) => d.posting_date).sort().at(-1) ?? null,
  };
}

export function overview(store: Store) {
  const accs = accounts(store);
  const jobs = listJobs(store);
  const fs = findings(store);
  const lines = glLines(store);
  const dates = lines.map((l) => l.posting_date).sort();
  const tb = lines.length ? trialBalance(store, dates[0], dates.at(-1)!) : null;
  return {
    accounts: { total: accs.length, active: accs.filter((a) => a.active).length },
    mappings: readMappings(store).length,
    jobs: { total: jobs.length, enabled: jobs.filter((j) => j.enabled).length },
    log_entries: store.get<LogEntry[]>(K_LOG, () => []).length,
    audit: { total: fs.length, open: fs.filter((f) => f.status === "open").length },
    ledger: { documents: new Set(lines.map((l) => l.document_no)).size, lines: lines.length, balanced: tb?.balanced ?? true },
    settings: getSettings(store),
  };
}
