import { appendAudit } from "@/server/audit";
import { nowIso, todayIsoDate } from "@/server/clock";
import { badRequest, notFound } from "@/server/http";
import type { Store } from "@/server/store";
import { dashboard as operational } from "./calc";
import { addDays, isIsoDate, lastDayOfMonth } from "./dates";
import { accounts, glLines, netByAccount, round2, type Account } from "./gl";

// Ledger reports. Every rule and shape here is our own design (spec/finance.md section 5);
// only the endpoint paths and request parameters are evidenced.

/** year/month from query values; both or neither (neither = the clock's month). */
export function periodOf(yearQ: string | null, monthQ: string | null) {
  let year: number;
  let month: number;
  if (!yearQ && !monthQ) {
    const t = todayIsoDate();
    year = Number(t.slice(0, 4));
    month = Number(t.slice(5, 7));
  } else {
    year = Number(yearQ);
    month = Number(monthQ);
    if (!yearQ || !monthQ || !Number.isInteger(year) || !Number.isInteger(month) || year < 2000 || year > 2100 || month < 1 || month > 12) {
      throw badRequest("year (2000-2100) and month (1-12) must be given together");
    }
  }
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  return { year, month, from, to: lastDayOfMonth(year, month) };
}

// ---- layouts ----

export interface LayoutSection {
  title: string;
  normal: "debit" | "credit";
  accounts: string[];
}
export interface Layout {
  sections: LayoutSection[];
}
export const LAYOUT_IDS = ["income-statement", "balance-sheet"] as const;
const K_LAYOUTS = "finance:gl:layouts";

interface StoredLayout {
  layout: Layout;
  updated_by: string | null;
  updated_at: string | null;
}

const seedLayouts = (): Record<string, StoredLayout> => ({
  "income-statement": {
    layout: {
      sections: [
        { title: "Revenue", normal: "credit", accounts: ["4000", "4100"] },
        { title: "Cost of goods sold", normal: "debit", accounts: ["5000"] },
        { title: "Operating expenses", normal: "debit", accounts: ["6000", "6100"] },
      ],
    },
    updated_by: null,
    updated_at: null,
  },
  "balance-sheet": {
    layout: {
      sections: [
        { title: "Assets", normal: "debit", accounts: ["1000", "1100", "1200", "1300"] },
        { title: "Liabilities", normal: "credit", accounts: ["2000", "2100"] },
        { title: "Equity", normal: "credit", accounts: ["3000"] },
      ],
    },
    updated_by: null,
    updated_at: null,
  },
});

function storedLayout(store: Store, id: string): StoredLayout {
  if (!(LAYOUT_IDS as readonly string[]).includes(id)) throw notFound(`Unknown layout: ${id}`);
  return store.get(K_LAYOUTS, seedLayouts)[id];
}

export function getLayout(store: Store, id: string) {
  return { id, ...storedLayout(store, id) };
}

export function saveLayout(store: Store, id: string, layout: unknown, actor: string) {
  storedLayout(store, id);
  const sections = (layout as Layout | null)?.sections;
  if (!Array.isArray(sections) || sections.length === 0 || sections.length > 20) throw badRequest("layout.sections must be a list of 1 to 20 sections");
  const known = new Set(accounts(store).map((a) => a.account_no));
  const used = new Set<string>();
  const clean: LayoutSection[] = sections.map((s: Partial<LayoutSection>) => {
    if (typeof s?.title !== "string" || !s.title.trim()) throw badRequest("each section needs a title");
    if (s.normal !== "debit" && s.normal !== "credit") throw badRequest('section.normal must be "debit" or "credit"');
    if (!Array.isArray(s.accounts)) throw badRequest("section.accounts must be a list");
    for (const a of s.accounts) {
      if (typeof a !== "string" || !known.has(a)) throw badRequest(`Unknown account: ${String(a)}`);
      if (used.has(a)) throw badRequest(`Account ${a} appears in more than one section`);
      used.add(a);
    }
    return { title: s.title.trim(), normal: s.normal, accounts: [...s.accounts] };
  });
  const out: StoredLayout = { layout: { sections: clean }, updated_by: actor, updated_at: nowIso() };
  store.update(K_LAYOUTS, seedLayouts, (all) => void (all[id] = out));
  appendAudit(store, { source: "finance", actor, action: "layout.save", detail: id });
  return { id, ...out };
}

// ---- trial balance ----

export function trialBalance(store: Store, from: string | null, to: string | null) {
  if (!from || !to || !isIsoDate(from) || !isIsoDate(to)) throw badRequest("date_from and date_to are required, as YYYY-MM-DD");
  if (from > to) throw badRequest("date_from must not be after date_to");
  const before = netByAccount(store, { to: addDays(from, -1) });
  const within = netByAccount(store, { from, to });
  const rows = accounts(store)
    .map((a) => {
      const opening = round2((before.get(a.account_no)?.debit ?? 0) - (before.get(a.account_no)?.credit ?? 0));
      const debit = round2(within.get(a.account_no)?.debit ?? 0);
      const credit = round2(within.get(a.account_no)?.credit ?? 0);
      return { account_no: a.account_no, name: a.name, type: a.type, opening, debit, credit, closing: round2(opening + debit - credit) };
    })
    .filter((r) => r.opening !== 0 || r.debit !== 0 || r.credit !== 0);
  const sum = (f: (r: (typeof rows)[number]) => number) => round2(rows.reduce((s, r) => s + f(r), 0));
  const totals = { opening: sum((r) => r.opening), debit: sum((r) => r.debit), credit: sum((r) => r.credit), closing: sum((r) => r.closing) };
  return { date_from: from, date_to: to, rows, totals, balanced: totals.debit === totals.credit && totals.opening === 0 && totals.closing === 0 };
}

// ---- income statement and balance sheet ----

export function incomeStatement(store: Store, year: number, month: number) {
  const p = periodOf(String(year), String(month));
  const accs = accounts(store);
  const month_ = netByAccount(store, { from: p.from, to: p.to });
  const ytd = netByAccount(store, { from: `${year}-01-01`, to: p.to });
  const { layout } = storedLayout(store, "income-statement");
  const placed = new Set(layout.sections.flatMap((s) => s.accounts));
  let netMonth = 0;
  let netYtd = 0;
  const sections = layout.sections.map((s) => {
    const sign = s.normal === "credit" ? 1 : -1;
    const lines = s.accounts.map((no) => {
      const a = accs.find((x) => x.account_no === no)!;
      const m = round2(((month_.get(no)?.credit ?? 0) - (month_.get(no)?.debit ?? 0)) * (s.normal === "credit" ? 1 : -1));
      const y = round2(((ytd.get(no)?.credit ?? 0) - (ytd.get(no)?.debit ?? 0)) * (s.normal === "credit" ? 1 : -1));
      return { account_no: no, name: a.name, month: m, ytd: y };
    });
    const mt = round2(lines.reduce((t, l) => t + l.month, 0));
    const yt = round2(lines.reduce((t, l) => t + l.ytd, 0));
    netMonth += sign * mt;
    netYtd += sign * yt;
    return { title: s.title, normal: s.normal, lines, month_total: mt, ytd_total: yt };
  });
  const unmapped = accs.filter((a) => (a.type === "revenue" || a.type === "expense") && !placed.has(a.account_no) && (ytd.has(a.account_no) || month_.has(a.account_no))).map((a) => a.account_no);
  return { year, month, date_from: p.from, date_to: p.to, sections, net_income: { month: round2(netMonth), ytd: round2(netYtd) }, unmapped_accounts: unmapped };
}

export function balanceSheet(store: Store, asOf: string | null) {
  if (!asOf || !isIsoDate(asOf)) throw badRequest("as_of is required, as YYYY-MM-DD");
  const accs = accounts(store);
  const bal = netByAccount(store, { to: asOf });
  const { layout } = storedLayout(store, "balance-sheet");
  const placed = new Set(layout.sections.flatMap((s) => s.accounts));
  const earnings = round2(
    accs.filter((a) => a.type === "revenue" || a.type === "expense").reduce((s, a) => s + ((bal.get(a.account_no)?.credit ?? 0) - (bal.get(a.account_no)?.debit ?? 0)), 0),
  );
  let debitSide = 0;
  let creditSide = 0;
  const sections = layout.sections.map((s) => {
    const lines = s.accounts.map((no) => {
      const b = bal.get(no);
      const v = s.normal === "debit" ? (b?.debit ?? 0) - (b?.credit ?? 0) : (b?.credit ?? 0) - (b?.debit ?? 0);
      return { account_no: no, name: accs.find((a) => a.account_no === no)!.name, balance: round2(v) };
    });
    const total = round2(lines.reduce((t, l) => t + l.balance, 0));
    if (s.normal === "debit") debitSide += total;
    else creditSide += total;
    return { title: s.title, normal: s.normal, lines, total };
  });
  const unmapped = accs.filter((a) => a.type !== "revenue" && a.type !== "expense" && !placed.has(a.account_no) && bal.has(a.account_no)).map((a) => a.account_no);
  return {
    as_of: asOf,
    sections,
    current_earnings: earnings,
    total_debit_side: round2(debitSide),
    total_credit_side: round2(creditSide + earnings),
    balanced: Math.abs(debitSide - creditSide - earnings) < 0.005,
    unmapped_accounts: unmapped,
  };
}

// ---- budget ----

export interface BudgetEntry {
  account_no: string;
  month: number;
  amount: number;
}
const K_BUDGET = "finance:gl:budget";
const readBudgets = (store: Store) => store.get<Record<string, BudgetEntry[]>>(K_BUDGET, () => ({}));
const isPnl = (a: Account) => a.type === "revenue" || a.type === "expense";

function checkYear(v: unknown): number {
  const y = Number(v);
  if (v === null || v === undefined || v === "" || !Number.isInteger(y) || y < 2000 || y > 2100) throw badRequest("year must be an integer from 2000 to 2100");
  return y;
}

export function getBudget(store: Store, yearQ: unknown) {
  const year = checkYear(yearQ);
  const entries = (readBudgets(store)[year] ?? []).sort((a, b) => a.account_no.localeCompare(b.account_no) || a.month - b.month);
  const accs = accounts(store).filter(isPnl);
  const typeOf = new Map(accs.map((a) => [a.account_no, a.type]));
  const total = (t: string) => round2(entries.filter((e) => typeOf.get(e.account_no) === t).reduce((s, e) => s + e.amount, 0));
  return { year, entries, accounts: accs.map(({ account_no, name, type }) => ({ account_no, name, type })), total_revenue: total("revenue"), total_expenses: total("expense") };
}

export function saveBudget(store: Store, yearQ: unknown, entries: unknown, actor: string) {
  const year = checkYear(yearQ);
  if (!Array.isArray(entries) || entries.length > 1000) throw badRequest("entries must be a list of at most 1000 items");
  const pnl = new Set(accounts(store).filter(isPnl).map((a) => a.account_no));
  const seen = new Set<string>();
  const clean = entries.map((e: Partial<BudgetEntry>) => {
    if (typeof e?.account_no !== "string" || !pnl.has(e.account_no)) throw badRequest(`Budget accounts must be revenue or expense accounts: ${String(e?.account_no)}`);
    if (!Number.isInteger(e.month) || (e.month as number) < 1 || (e.month as number) > 12) throw badRequest("month must be an integer from 1 to 12");
    if (typeof e.amount !== "number" || !Number.isFinite(e.amount) || e.amount < 0) throw badRequest("amount must be a number of 0 or more");
    const key = `${e.account_no}/${e.month}`;
    if (seen.has(key)) throw badRequest(`Duplicate budget entry: ${key}`);
    seen.add(key);
    return { account_no: e.account_no, month: e.month as number, amount: round2(e.amount) };
  });
  store.update(K_BUDGET, () => ({}) as Record<string, BudgetEntry[]>, (all) => void (all[year] = clean));
  appendAudit(store, { source: "finance", actor, action: "budget.save", detail: `${year}: ${clean.length} entries` });
  return getBudget(store, year);
}

export function seedBudget(store: Store, body: { year?: unknown; source_year?: unknown; factor?: unknown }, actor: string) {
  const year = checkYear(body.year);
  const src = checkYear(body.source_year);
  const factor = body.factor;
  if (typeof factor !== "number" || !Number.isFinite(factor) || factor <= 0 || factor > 10) throw badRequest("factor must be a number above 0 and up to 10");
  const accs = accounts(store).filter(isPnl);
  const entries: BudgetEntry[] = [];
  for (const l of glLines(store)) {
    if (!l.posting_date.startsWith(`${src}-`)) continue;
    const a = accs.find((x) => x.account_no === l.account_no);
    if (!a) continue;
    const month = Number(l.posting_date.slice(5, 7));
    const v = a.type === "revenue" ? l.credit - l.debit : l.debit - l.credit;
    const e = entries.find((x) => x.account_no === a.account_no && x.month === month);
    if (e) e.amount += v;
    else entries.push({ account_no: a.account_no, month, amount: v });
  }
  const clean = entries.map((e) => ({ ...e, amount: round2(Math.max(0, e.amount) * factor) })).filter((e) => e.amount > 0);
  if (!clean.length) throw badRequest(`No ledger activity in ${src} to seed from`);
  store.update(K_BUDGET, () => ({}) as Record<string, BudgetEntry[]>, (all) => void (all[year] = clean));
  appendAudit(store, { source: "finance", actor, action: "budget.seed", detail: `${year} from ${src} x ${factor}` });
  return getBudget(store, year);
}

// ---- dashboard ----

export function financeDashboard(store: Store, yearQ: string | null, monthQ: string | null) {
  const p = periodOf(yearQ, monthQ);
  const today = todayIsoDate();
  const asOf = p.from <= today && today <= p.to ? today : p.to;
  const accs = accounts(store);
  const inc = incomeStatement(store, p.year, p.month);
  const bal = balanceSheet(store, p.to);
  const bs = (no: string) => bal.sections.flatMap((s) => s.lines).find((l) => l.account_no === no)?.balance ?? 0;
  const sect = (title: string) => inc.sections.find((s) => s.title === title);
  const revenue = sect("Revenue");
  const cogs = sect("Cost of goods sold");
  const opex = sect("Operating expenses");
  const tb = trialBalance(store, `${p.year}-01-01`, p.to);

  const months = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const net = netByAccount(store, { from: `${p.year}-${String(m).padStart(2, "0")}-01`, to: lastDayOfMonth(p.year, m) });
    let rev = 0;
    let exp = 0;
    for (const a of accs) {
      const t = net.get(a.account_no);
      if (!t) continue;
      if (a.type === "revenue") rev += t.credit - t.debit;
      if (a.type === "expense") exp += t.debit - t.credit;
    }
    return { month: m, revenue: round2(rev), expenses: round2(exp), net_income: round2(rev - exp) };
  });

  const budget = readBudgets(store)[p.year] ?? [];
  const typeOf = new Map(accs.map((a) => [a.account_no, a.type]));
  const b = (t: string) => round2(budget.filter((e) => e.month === p.month && typeOf.get(e.account_no) === t).reduce((s, e) => s + e.amount, 0));
  const expensesActual = round2((cogs?.month_total ?? 0) + (opex?.month_total ?? 0));
  const lines = glLines(store);
  const ytdRevenue = revenue?.ytd_total ?? 0;
  const ytdGross = ytdRevenue - (cogs?.ytd_total ?? 0);

  return {
    year: p.year,
    month: p.month,
    date_from: p.from,
    date_to: p.to,
    as_of: asOf,
    generated_at: nowIso().slice(0, 19),
    gl: {
      revenue_month: revenue?.month_total ?? 0,
      expenses_month: expensesActual,
      net_income_month: inc.net_income.month,
      revenue_ytd: ytdRevenue,
      net_income_ytd: inc.net_income.ytd,
      gross_margin_pct_ytd: ytdRevenue ? Math.round((ytdGross / ytdRevenue) * 1000) / 10 : 0,
      cash: bs("1000"),
      receivables: bs("1100"),
      inventory: bs("1200"),
      payables: bs("2000"),
      trial_balance_balanced: tb.balanced,
      documents: new Set(lines.map((l) => l.document_no)).size,
      lines: lines.length,
      last_posting_date: lines.map((l) => l.posting_date).sort().at(-1) ?? null,
    },
    months,
    budget: { has_budget: budget.length > 0, revenue: { actual: revenue?.month_total ?? 0, budget: b("revenue"), variance: round2((revenue?.month_total ?? 0) - b("revenue")) }, expenses: { actual: expensesActual, budget: b("expense"), variance: round2(expensesActual - b("expense")) } },
    operational: operational(store, asOf),
  };
}
