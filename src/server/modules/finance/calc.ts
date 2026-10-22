import { nowIso } from "@/server/clock";
import { master } from "@/server/master";
import { planLines, YELLOW_AT_RISK_WEIGHT } from "@/server/plan";
import type { Store } from "@/server/store";
import { cashBalance } from "./gl";
import { getSettings, type FinanceSettings as FinanceConfig } from "./settings";
import { addDays, daysBetween } from "./dates";

// Finance views derived from master data and the plan. Every rule is our own design (spec/finance.md).

export type BucketKey = "overdue" | "d0_30" | "d31_60" | "d61_90" | "d90_plus";
const BUCKETS: { key: BucketKey; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "d0_30", label: "Due 0-30d" },
  { key: "d31_60", label: "Due 31-60d" },
  { key: "d61_90", label: "Due 61-90d" },
  { key: "d90_plus", label: "Due 90d+" },
];

export const round2 = (n: number) => Math.round(n * 100) / 100;
const pct1 = (n: number) => Math.round(n * 10) / 10;

export function bucketOf(daysToDue: number): BucketKey {
  if (daysToDue < 0) return "overdue";
  if (daysToDue <= 30) return "d0_30";
  if (daysToDue <= 60) return "d31_60";
  if (daysToDue <= 90) return "d61_90";
  return "d90_plus";
}

export interface ReceivableLine {
  so_number: string;
  line_no: string;
  customer_id: string;
  customer_name: string;
  series: string | null;
  amount: number;
  delivery_date: string;
  due_date: string;
  days_to_due: number;
  days_overdue: number;
  bucket: BucketKey;
}

export interface PayableLine {
  po_number: string;
  line_no: string;
  vendor_id: string;
  vendor_name: string;
  component_item_no: string;
  amount: number;
  receipt_date: string;
  due_date: string;
  days_to_due: number;
  days_overdue: number;
  bucket: BucketKey;
}

export interface Aging<L> {
  total: number;
  buckets: { key: BucketKey; label: string; amount: number; count: number }[];
  lines: L[];
}

function aging<L extends { amount: number; bucket: BucketKey }>(lines: L[]): Aging<L> {
  return {
    total: round2(lines.reduce((s, l) => s + l.amount, 0)),
    buckets: BUCKETS.map((b) => {
      const inB = lines.filter((l) => l.bucket === b.key);
      return { ...b, amount: round2(inB.reduce((s, l) => s + l.amount, 0)), count: inB.length };
    }),
    lines,
  };
}

const byDueThenDoc = <T extends { due_date: string }>(key: (l: T) => string) => (a: T, b: T) =>
  a.due_date.localeCompare(b.due_date) || key(a).localeCompare(key(b));

export function receivables(store: Store, asOf: string, cfg: FinanceConfig): Aging<ReceivableLine> {
  const customers = master(store, "customers");
  const items = master(store, "fg_items");
  const lines = master(store, "sales_lines").map<ReceivableLine>((l) => {
    const due = addDays(l.delivery_date, cfg.customer_terms_days);
    const d = daysBetween(asOf, due);
    return {
      so_number: l.so_number,
      line_no: l.line_no,
      customer_id: l.customer_id,
      customer_name: customers.find((c) => c.id === l.customer_id)?.name ?? l.customer_id,
      series: items.find((i) => i.item_no === l.fg_item_no)?.series ?? null,
      amount: round2(l.quantity * l.unit_price),
      delivery_date: l.delivery_date,
      due_date: due,
      days_to_due: d,
      days_overdue: Math.max(0, -d),
      bucket: bucketOf(d),
    };
  });
  return aging(lines.sort(byDueThenDoc((l) => l.so_number + l.line_no)));
}

export function payables(store: Store, asOf: string, cfg: FinanceConfig): Aging<PayableLine> {
  const vendors = master(store, "vendors");
  const comps = master(store, "components");
  const lines = master(store, "vendor_po_lines")
    .filter((l) => l.status === "Open")
    .map<PayableLine>((l) => {
      const due = addDays(l.receipt_date, cfg.vendor_terms_days);
      const d = daysBetween(asOf, due);
      const cost = comps.find((c) => c.item_no === l.component_item_no)?.unit_cost ?? 0;
      return {
        po_number: l.po_number,
        line_no: l.line_no,
        vendor_id: l.vendor_id,
        vendor_name: vendors.find((v) => v.id === l.vendor_id)?.name ?? l.vendor_id,
        component_item_no: l.component_item_no,
        amount: round2(l.quantity * cost),
        receipt_date: l.receipt_date,
        due_date: due,
        days_to_due: d,
        days_overdue: Math.max(0, -d),
        bucket: bucketOf(d),
      };
    });
  return aging(lines.sort(byDueThenDoc((l) => l.po_number + l.line_no)));
}

export interface MarginRow {
  quantity: number;
  revenue: number;
  cost: number;
  margin: number;
  margin_pct: number;
}

export function margin(store: Store): { series: (MarginRow & { series: string })[]; total: MarginRow } {
  const items = master(store, "fg_items");
  const bom = master(store, "bom");
  const comps = master(store, "components");
  const rollup = (fg: string) =>
    bom.filter((b) => b.fg_item_no === fg).reduce((s, b) => s + b.qty_per * (comps.find((c) => c.item_no === b.component_item_no)?.unit_cost ?? 0), 0);

  const acc = new Map<string, { quantity: number; revenue: number; cost: number }>();
  for (const l of master(store, "sales_lines")) {
    const s = items.find((i) => i.item_no === l.fg_item_no)?.series ?? "other";
    const a = acc.get(s) ?? { quantity: 0, revenue: 0, cost: 0 };
    a.quantity += l.quantity;
    a.revenue += l.quantity * l.unit_price;
    a.cost += l.quantity * rollup(l.fg_item_no);
    acc.set(s, a);
  }
  const row = (a: { quantity: number; revenue: number; cost: number }): MarginRow => ({
    quantity: a.quantity,
    revenue: round2(a.revenue),
    cost: round2(a.cost),
    margin: round2(a.revenue - a.cost),
    margin_pct: a.revenue ? pct1(((a.revenue - a.cost) / a.revenue) * 100) : 0,
  });
  const series = [...acc.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([s, a]) => ({ series: s, ...row(a) }));
  const t = [...acc.values()].reduce((x, a) => ({ quantity: x.quantity + a.quantity, revenue: x.revenue + a.revenue, cost: x.cost + a.cost }), { quantity: 0, revenue: 0, cost: 0 });
  return { series, total: row(t) };
}

export interface RiskLine {
  so_number: string;
  line_no: string;
  customer_name: string | null;
  series: string | null;
  health: string;
  delivery_date: string;
  amount: number;
  at_risk_value: number;
}

export function risk(store: Store) {
  const all = planLines(store);
  const openValue = all.reduce((s, r) => s + r.quantity * r.unit_price, 0);
  const lines = all
    .map<RiskLine>((r) => {
      const amount = r.quantity * r.unit_price;
      const w = r.health === "red" ? 1 : r.health === "yellow" ? YELLOW_AT_RISK_WEIGHT : 0;
      return { so_number: r.so_number, line_no: r.item_no, customer_name: r.customer_name, series: r.series, health: r.health, delivery_date: r.delivery_date ?? "", amount: round2(amount), at_risk_value: round2(amount * w) };
    })
    .filter((r) => r.at_risk_value > 0)
    .sort((a, b) => b.at_risk_value - a.at_risk_value || a.so_number.localeCompare(b.so_number));
  const total = round2(lines.reduce((s, r) => s + r.at_risk_value, 0));
  return { total, open_value: round2(openValue), pct_of_open: openValue ? pct1((total / openValue) * 100) : 0, lines };
}

const WEEKS = 13;

export function cashForecast(asOf: string, ar: Aging<ReceivableLine>, ap: Aging<PayableLine>, opening: number) {
  const weeks = Array.from({ length: WEEKS }, (_, i) => ({ index: i, start: addDays(asOf, 7 * i), end: addDays(asOf, 7 * i + 6), inflow: 0, outflow: 0, net: 0, closing: 0 }));
  const beyond = { inflow: 0, outflow: 0 };
  const place = (daysToDue: number, amount: number, side: "inflow" | "outflow") => {
    if (daysToDue >= WEEKS * 7) beyond[side] += amount;
    else weeks[Math.max(0, Math.floor(daysToDue / 7))][side] += amount;
  };
  for (const l of ar.lines) place(l.days_to_due, l.amount, "inflow");
  for (const l of ap.lines) place(l.days_to_due, l.amount, "outflow");
  let bal = opening;
  let min = opening;
  let minWeek: number | null = null;
  for (const w of weeks) {
    w.inflow = round2(w.inflow);
    w.outflow = round2(w.outflow);
    w.net = round2(w.inflow - w.outflow);
    bal = round2(bal + w.net);
    w.closing = bal;
    if (bal < min) {
      min = bal;
      minWeek = w.index;
    }
  }
  return { opening, weeks, beyond_horizon: { inflow: round2(beyond.inflow), outflow: round2(beyond.outflow) }, min_cash: min, min_week: minWeek };
}

export function dashboard(store: Store, asOf: string) {
  const config = getSettings(store);
  const ar = receivables(store, asOf, config);
  const ap = payables(store, asOf, config);
  const mg = margin(store);
  const rk = risk(store);
  const cash = cashForecast(asOf, ar, ap, cashBalance(store, asOf));
  const overdue = (a: Aging<{ amount: number }>) => a.buckets.find((b) => b.key === "overdue")!.amount;
  return {
    as_of: asOf,
    generated_at: nowIso().slice(0, 19),
    config,
    kpis: {
      open_receivables: ar.total,
      overdue_receivables: overdue(ar),
      open_commitments: ap.total,
      overdue_payables: overdue(ap),
      gross_margin_pct: mg.total.margin_pct,
      revenue_at_risk: rk.total,
      revenue_at_risk_pct: rk.pct_of_open,
      min_cash: cash.min_cash,
    },
    receivables: ar,
    payables: ap,
    margin: mg,
    risk: rk,
    cash,
  };
}
