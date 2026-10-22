import { appendAudit } from "@/server/audit";
import { nowIso, todayIsoDate } from "@/server/clock";
import { badRequest, notFound } from "@/server/http";
import { master } from "@/server/master";
import type { Store } from "@/server/store";
import { addDays, isIsoDate } from "./dates";
import { getSettings } from "./settings";

// A deterministic simulated general ledger derived from master data (spec/finance.md section 5).
// Every posting rule here is our own design; the original ledger and its ERP are unknown.

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type Source = "opening" | "sales" | "inventory" | "purchasing" | "expense" | "manual";
export const SOURCES: Source[] = ["opening", "sales", "inventory", "purchasing", "expense", "manual"];

export interface Account {
  account_no: string;
  name: string;
  type: AccountType;
  active: boolean;
}

export interface GlLine {
  id: number;
  document_no: string;
  posting_date: string;
  account_no: string;
  description: string;
  debit: number;
  credit: number;
  source: Source;
}

export interface Mapping {
  id: string;
  kind: string;
  key: string;
  value: string;
  updated_by: string;
  updated_at: string;
}

const K_ACCOUNTS = "finance:gl:accounts";
const K_LINES = "finance:gl:lines";
const K_SYNC = "finance:gl:sync";
export const K_MAPPINGS = "finops:mappings";

export const round2 = (n: number) => Math.round(n * 100) / 100;

const seedAccounts = (): Account[] => [
  { account_no: "1000", name: "Cash", type: "asset", active: true },
  { account_no: "1100", name: "Accounts Receivable", type: "asset", active: true },
  { account_no: "1200", name: "Inventory", type: "asset", active: true },
  { account_no: "1300", name: "Prepaid Expenses", type: "asset", active: false },
  { account_no: "2000", name: "Accounts Payable", type: "liability", active: true },
  { account_no: "2100", name: "Accrued Liabilities", type: "liability", active: false },
  { account_no: "3000", name: "Share Capital", type: "equity", active: true },
  { account_no: "4000", name: "Sales Revenue", type: "revenue", active: true },
  { account_no: "4100", name: "Other Revenue", type: "revenue", active: false },
  { account_no: "5000", name: "Cost of Goods Sold", type: "expense", active: true },
  { account_no: "6000", name: "Rent Expense", type: "expense", active: true },
  { account_no: "6100", name: "Freight Expense", type: "expense", active: false },
];

export const accounts = (store: Store): Account[] => store.get(K_ACCOUNTS, seedAccounts);
export const readMappings = (store: Store): Mapping[] => store.get<Mapping[]>(K_MAPPINGS, () => []);

interface Draft {
  document_no: string;
  posting_date: string;
  source: Source;
  description: string;
  entries: { account_no: string; debit?: number; credit?: number }[];
}

function buildDocuments(store: Store): Draft[] {
  const year = todayIsoDate().slice(0, 4);
  const month = Number(todayIsoDate().slice(5, 7));
  const maps = readMappings(store);
  const map = (kind: string, key: string, dflt: string) => maps.find((m) => m.kind === kind && m.key === key)?.value ?? dflt;
  const fg = master(store, "fg_items");
  const bom = master(store, "bom");
  const comps = master(store, "components");
  const vendors = master(store, "vendors");
  const cost = (itemNo: string) => bom.filter((b) => b.fg_item_no === itemNo).reduce((s, b) => s + b.qty_per * (comps.find((c) => c.item_no === b.component_item_no)?.unit_cost ?? 0), 0);
  const docs: Draft[] = [];

  const settings = getSettings(store);
  const stock = round2(comps.reduce((s, c) => s + c.on_hand * c.unit_cost, 0));
  const opening: Draft["entries"] = [];
  if (settings.opening_cash > 0) opening.push({ account_no: "1000", debit: settings.opening_cash });
  if (stock > 0) opening.push({ account_no: "1200", debit: stock });
  opening.push({ account_no: "3000", credit: round2(settings.opening_cash + stock) });
  docs.push({ document_no: "JE-OPEN", posting_date: `${year}-01-01`, source: "opening", description: "Opening balances (cash, stock on hand, share capital)", entries: opening });

  for (let m = 1; m <= month; m++) {
    const mm = String(m).padStart(2, "0");
    docs.push({ document_no: `RENT-${year}-${mm}`, posting_date: `${year}-${mm}-01`, source: "expense", description: `Rent ${year}-${mm}`, entries: [{ account_no: "6000", debit: 3000 }, { account_no: "1000", credit: 3000 }] });
  }

  const sales = master(store, "sales_lines");
  for (const l of sales) {
    const item = fg.find((i) => i.item_no === l.fg_item_no);
    const amount = round2(l.quantity * l.unit_price);
    const c = round2(l.quantity * cost(l.fg_item_no));
    const tag = `${l.so_number}-${l.line_no}`;
    docs.push({ document_no: `INV-${tag}`, posting_date: l.order_date, source: "sales", description: `Invoice ${l.so_number} line ${l.line_no}`, entries: [{ account_no: "1100", debit: amount }, { account_no: map("series-account", item?.series ?? "", "4000"), credit: amount }] });
    if (c > 0) docs.push({ document_no: `COGS-${tag}`, posting_date: l.order_date, source: "inventory", description: `Cost of sales ${l.so_number} line ${l.line_no}`, entries: [{ account_no: "5000", debit: c }, { account_no: "1200", credit: c }] });
  }

  for (const p of master(store, "vendor_po_lines")) {
    const v = vendors.find((x) => x.id === p.vendor_id);
    const amount = round2(p.quantity * (comps.find((c) => c.item_no === p.component_item_no)?.unit_cost ?? 0));
    if (amount <= 0) continue;
    docs.push({
      document_no: `BILL-${p.po_number}-${p.line_no}`,
      posting_date: addDays(p.need_date, -(v?.lead_time_days ?? 0)),
      source: "purchasing",
      description: `Vendor bill ${p.po_number} line ${p.line_no} (${v?.name ?? p.vendor_id})`,
      entries: [{ account_no: map("vendor-account", p.vendor_id, "1200"), debit: amount }, { account_no: "2000", credit: amount }],
    });
  }

  if (sales.length) docs.push({ document_no: "MAN-0001", posting_date: addDays(sales[0].delivery_date, -10), source: "manual", description: `Freight on ${sales[0].so_number} (manual entry)`, entries: [{ account_no: "6100", debit: 120 }, { account_no: "1000", credit: 120 }] });
  return docs;
}

function toLines(docs: Draft[], firstId: number): GlLine[] {
  const sorted = [...docs].sort((a, b) => a.posting_date.localeCompare(b.posting_date) || a.document_no.localeCompare(b.document_no));
  let id = firstId;
  return sorted.flatMap((d) =>
    d.entries.map<GlLine>((e) => ({ id: id++, document_no: d.document_no, posting_date: d.posting_date, account_no: e.account_no, description: d.description, debit: e.debit ?? 0, credit: e.credit ?? 0, source: d.source })),
  );
}

export const glLines = (store: Store): GlLine[] => store.get(K_LINES, () => toLines(buildDocuments(store), 1));

export interface SyncState {
  last_sync_at: string | null;
  last_mode: "full" | "incremental" | null;
  last_added: number;
}
const syncState = (store: Store): SyncState => store.get(K_SYNC, () => ({ last_sync_at: null, last_mode: null, last_added: 0 }));

/** Simulated connector: rebuilds (full) or tops up (incremental) the ledger from master data. */
export function sync(store: Store, full: unknown, actor: string) {
  if (full !== undefined && typeof full !== "boolean") throw badRequest("full must be a boolean");
  const drafts = buildDocuments(store);
  const before = glLines(store);
  let lines: GlLine[];
  let added: number;
  if (full) {
    lines = toLines(drafts, 1);
    added = lines.length;
  } else {
    const have = new Set(before.map((l) => l.document_no));
    const fresh = toLines(drafts.filter((d) => !have.has(d.document_no)), Math.max(0, ...before.map((l) => l.id)) + 1);
    lines = [...before, ...fresh];
    added = fresh.length;
  }
  store.set(K_LINES, lines);
  const state: SyncState = { last_sync_at: nowIso(), last_mode: full ? "full" : "incremental", last_added: added };
  store.set(K_SYNC, state);
  appendAudit(store, { source: "finance", actor, action: "gl.sync", detail: `${state.last_mode}: ${added} line(s) added (simulated connector)` });
  return { ...syncStatus(store), added_lines: added };
}

export function syncStatus(store: Store) {
  const lines = glLines(store);
  return {
    status: "idle",
    simulated: true,
    connector: "Local simulated connector (no external ERP)",
    ...syncState(store),
    documents: new Set(lines.map((l) => l.document_no)).size,
    lines: lines.length,
  };
}

export function refreshAccounts(store: Store, actor: string) {
  const used = new Set(glLines(store).map((l) => l.account_no));
  let activated = 0;
  let deactivated = 0;
  const list = store.update(K_ACCOUNTS, seedAccounts, (accs) => {
    for (const a of accs) {
      const want = used.has(a.account_no);
      if (want && !a.active) activated++;
      if (!want && a.active) deactivated++;
      a.active = want;
    }
    return accs;
  });
  appendAudit(store, { source: "finance", actor, action: "accounts.refresh", detail: `activated ${activated}, deactivated ${deactivated} (simulated)` });
  return { accounts: list.length, activated, deactivated };
}

// ---- queries ----

function checkDate(name: string, v: string | null): string | undefined {
  if (!v) return undefined;
  if (!isIsoDate(v)) throw badRequest(`${name} must be a date in YYYY-MM-DD format`);
  return v;
}

export interface GlQuery {
  account_no?: string | null;
  source?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  q?: string | null;
  limit?: string | null;
  offset?: string | null;
}

export function queryGl(store: Store, p: GlQuery) {
  const from = checkDate("date_from", p.date_from ?? null);
  const to = checkDate("date_to", p.date_to ?? null);
  if (from && to && from > to) throw badRequest("date_from must not be after date_to");
  if (p.source && !SOURCES.includes(p.source as Source)) throw badRequest(`source must be one of ${SOURCES.join(", ")}`);
  const limit = p.limit ? Number(p.limit) : 200;
  const offset = p.offset ? Number(p.offset) : 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw badRequest("limit must be an integer from 1 to 1000");
  if (!Number.isInteger(offset) || offset < 0) throw badRequest("offset must be an integer of 0 or more");
  const q = (p.q ?? "").trim().toLowerCase();
  const names = new Map(accounts(store).map((a) => [a.account_no, a.name]));
  const all = glLines(store)
    .filter((l) => (!p.account_no || l.account_no === p.account_no) && (!p.source || l.source === p.source) && (!from || l.posting_date >= from) && (!to || l.posting_date <= to) && (!q || `${l.document_no} ${l.description}`.toLowerCase().includes(q)))
    .sort((a, b) => a.posting_date.localeCompare(b.posting_date) || a.document_no.localeCompare(b.document_no) || a.id - b.id);
  return {
    total: all.length,
    limit,
    offset,
    totals: { debit: round2(all.reduce((s, l) => s + l.debit, 0)), credit: round2(all.reduce((s, l) => s + l.credit, 0)) },
    lines: all.slice(offset, offset + limit).map((l) => ({ ...l, account_name: names.get(l.account_no) ?? l.account_no })),
  };
}

export function facets(store: Store) {
  const lines = glLines(store);
  const names = new Map(accounts(store).map((a) => [a.account_no, a.name]));
  const count = <T extends string>(f: (l: GlLine) => T) => {
    const m = new Map<T, number>();
    for (const l of lines) m.set(f(l), (m.get(f(l)) ?? 0) + 1);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  };
  const dates = lines.map((l) => l.posting_date).sort();
  return {
    accounts: count((l) => l.account_no).map(([account_no, n]) => ({ account_no, name: names.get(account_no) ?? account_no, count: n })),
    sources: count((l) => l.source).map(([source, n]) => ({ source, count: n })),
    years: [...new Set(dates.map((d) => Number(d.slice(0, 4))))],
    date_min: dates[0] ?? null,
    date_max: dates.at(-1) ?? null,
  };
}

export function documentOf(store: Store, no: string) {
  const names = new Map(accounts(store).map((a) => [a.account_no, a.name]));
  const lines = glLines(store).filter((l) => l.document_no === no);
  if (!lines.length) throw notFound(`Unknown document: ${no}`);
  const debit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const credit = round2(lines.reduce((s, l) => s + l.credit, 0));
  return {
    document_no: no,
    posting_date: lines[0].posting_date,
    source: lines[0].source,
    description: lines[0].description,
    lines: lines.map((l) => ({ ...l, account_name: names.get(l.account_no) ?? l.account_no })),
    total_debit: debit,
    total_credit: credit,
    balanced: Math.abs(debit - credit) < 0.005,
  };
}

/** Net debit-minus-credit per account through `to` (inclusive), optionally from `from`. */
export function netByAccount(store: Store, opts: { from?: string; to?: string }): Map<string, { debit: number; credit: number }> {
  const m = new Map<string, { debit: number; credit: number }>();
  for (const l of glLines(store)) {
    if ((opts.from && l.posting_date < opts.from) || (opts.to && l.posting_date > opts.to)) continue;
    const a = m.get(l.account_no) ?? { debit: 0, credit: 0 };
    a.debit += l.debit;
    a.credit += l.credit;
    m.set(l.account_no, a);
  }
  return m;
}

export function cashBalance(store: Store, asOf: string): number {
  const a = netByAccount(store, { to: asOf }).get("1000");
  return a ? round2(a.debit - a.credit) : 0;
}
