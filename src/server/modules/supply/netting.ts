import { todayIsoDate } from "../../clock";
import { master, type Component, type SalesLine, type VendorPoLine } from "../../master";
import type { Store } from "../../store";
import { supplyData, type SupplyData } from "./data";

export type Status = "red" | "yellow" | "green";
const SEVERITY: Record<Status, number> = { red: 0, yellow: 1, green: 2 };

export const addDays = (iso: string, n: number): string => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const round2 = (v: number) => Math.round(v * 100) / 100;

interface Ctx {
  today: string;
  sd: SupplyData;
  lines: SalesLine[];
  comps: Component[];
  bom: ReturnType<typeof master<"bom">>;
  vendors: ReturnType<typeof master<"vendors">>;
  customers: ReturnType<typeof master<"customers">>;
  fgs: ReturnType<typeof master<"fg_items">>;
  prods: ReturnType<typeof master<"production_orders">>;
  openPos: VendorPoLine[];
  allPos: VendorPoLine[];
}

function ctx(store: Store): Ctx {
  const allPos = master(store, "vendor_po_lines");
  return {
    today: todayIsoDate(),
    sd: supplyData(store),
    lines: master(store, "sales_lines"),
    comps: master(store, "components"),
    bom: master(store, "bom"),
    vendors: master(store, "vendors"),
    customers: master(store, "customers"),
    fgs: master(store, "fg_items"),
    prods: master(store, "production_orders"),
    allPos,
    openPos: allPos.filter((l) => l.status === "Open"),
  };
}

export interface BomRow {
  item_no: string;
  description: string;
  level: number;
  is_subassembly: boolean;
  /** Quantity per one unit of the finished good (nested quantities multiplied). */
  extended_qty: number;
}

/** BOM rows in BOM order; components listed under a sub-assembly follow its row (REQ-SUP-DAT-001). */
function bomRows(c: Ctx, fg: string): BomRow[] {
  const rows: BomRow[] = [];
  const subs = c.sd.subassemblies.filter((s) => s.fg_item_no === fg);
  const shown = new Set<string>();
  for (const b of c.bom.filter((x) => x.fg_item_no === fg)) {
    const desc = c.comps.find((k) => k.item_no === b.component_item_no)?.description ?? "";
    const sub = subs.find((s) => s.components.includes(b.component_item_no));
    if (sub) {
      if (!shown.has(sub.item_no)) {
        shown.add(sub.item_no);
        rows.push({ item_no: sub.item_no, description: sub.description, level: 1, is_subassembly: true, extended_qty: sub.qty_per });
      }
      rows.push({ item_no: b.component_item_no, description: desc, level: 2, is_subassembly: false, extended_qty: sub.qty_per * b.qty_per });
    } else {
      rows.push({ item_no: b.component_item_no, description: desc, level: 1, is_subassembly: false, extended_qty: b.qty_per });
    }
  }
  return rows;
}

function demandOf(c: Ctx, fg: string) {
  const ordered = c.lines.filter((l) => l.fg_item_no === fg).reduce((s, l) => s + l.quantity, 0);
  const planned = c.sd.planned_demand.filter((p) => p.item_no === fg).reduce((s, p) => s + p.quantity, 0);
  return { ordered, planned, total: ordered + planned };
}

export type DemandSource = "orders" | "plan" | "both" | "none";
function demandSource(c: Ctx, fg: string): DemandSource {
  const d = demandOf(c, fg);
  return d.ordered > 0 && d.planned > 0 ? "both" : d.ordered > 0 ? "orders" : d.planned > 0 ? "plan" : "none";
}

export function fgCatalog(store: Store) {
  const c = ctx(store);
  return c.fgs.map((f) => ({
    item_no: f.item_no,
    description: f.description,
    series: f.series,
    model: c.sd.models[f.item_no] ?? null,
    demand_source: demandSource(c, f.item_no),
  }));
}

const leadOf = (c: Ctx, comp: Component): number =>
  c.sd.params[comp.item_no]?.lead_time_days ?? c.vendors.find((v) => v.id === comp.vendor_id)?.lead_time_days ?? 0;

function status(net: number, availOnHand: number, required: number): Status {
  return net < 0 ? "red" : availOnHand < required ? "yellow" : "green";
}

// ---- vendor reliability (REQ-SUP-RULE-008) ----
function reliability(c: Ctx, vendorId: string) {
  const cutoff = addDays(c.today, -365);
  const hist = c.sd.receipt_history.filter((r) => r.vendor_id === vendorId && r.received_date >= cutoff);
  const open = c.allPos.filter((l) => l.vendor_id === vendorId && l.status === "Open");
  const sample = hist.length
    ? { src: "history, last 12 months", items: hist.map((r) => [r.need_date, r.received_date] as const) }
    : { src: "open lines", items: open.map((l) => [l.need_date, l.receipt_date] as const) };
  if (!sample.items.length) return { pct: null as number | null, src: "", avg: 0 };
  const lateDays = sample.items
    .filter(([need, got]) => got > need)
    .map(([need, got]) => (Date.parse(got) - Date.parse(need)) / 86400000);
  const pct = Math.round(((sample.items.length - lateDays.length) / sample.items.length) * 100);
  const avg = lateDays.length ? Math.round((lateDays.reduce((s, d) => s + d, 0) / lateDays.length) * 10) / 10 : 0;
  return { pct, src: sample.src, avg };
}

export interface DetailComponent {
  item_no: string;
  description: string;
  level: number;
  is_subassembly: boolean;
  qty_per_unit: number;
  required: number;
  on_hand: number;
  reserved: number;
  on_po: number;
  po_eta: string | null;
  net_available: number;
  status: Status;
  vendor_no: string;
  vendor_name: string | null;
  lead_time_days: number | null;
  last_direct_cost: number | null;
  unit_cost: number;
  minimum_order_qty: number;
  order_multiple: number;
  reservations: { reserved_for: string; qty: number }[];
  open_pos: { po_number: string; vendor_no: string; qty: number; eta: string }[];
}

export function supplyDetail(store: Store, fg: string) {
  const c = ctx(store);
  const item = c.fgs.find((f) => f.item_no === fg);
  if (!item) return null;
  const d = demandOf(c, fg);
  const nc = c.sd.nc_risk_pct;
  const mult = 1 + nc / 100;

  const components = bomRows(c, fg).map<DetailComponent>((r) => {
    const required = round2(d.total * r.extended_qty * mult);
    if (r.is_subassembly) {
      return {
        item_no: r.item_no, description: r.description, level: r.level, is_subassembly: true,
        qty_per_unit: r.extended_qty, required, on_hand: 0, reserved: 0, on_po: 0, po_eta: null,
        net_available: 0, status: "green", vendor_no: "", vendor_name: null, lead_time_days: null,
        last_direct_cost: null, unit_cost: 0, minimum_order_qty: 1, order_multiple: 1, reservations: [], open_pos: [],
      };
    }
    const comp = c.comps.find((k) => k.item_no === r.item_no);
    const reservations = c.sd.reservations[r.item_no] ?? [];
    const reserved = reservations.reduce((s, x) => s + x.qty, 0);
    const pos = c.openPos.filter((p) => p.component_item_no === r.item_no);
    const onPo = pos.reduce((s, p) => s + p.quantity, 0);
    const onHand = comp?.on_hand ?? 0;
    const net = round2(onHand - reserved + onPo - required);
    const vendor = comp ? c.vendors.find((v) => v.id === comp.vendor_id) : undefined;
    const params = c.sd.params[r.item_no];
    return {
      item_no: r.item_no, description: comp?.description ?? r.description, level: r.level, is_subassembly: false,
      qty_per_unit: r.extended_qty, required, on_hand: onHand, reserved, on_po: onPo,
      po_eta: pos.length ? pos.map((p) => p.receipt_date).sort()[0] : null,
      net_available: net, status: status(net, onHand - reserved, required),
      vendor_no: vendor?.id ?? "", vendor_name: vendor?.name ?? null,
      lead_time_days: comp ? leadOf(c, comp) || null : null,
      last_direct_cost: comp?.unit_cost ?? null, unit_cost: comp?.unit_cost ?? 0,
      minimum_order_qty: params?.minimum_order_qty ?? 1, order_multiple: params?.order_multiple ?? 1,
      reservations: reservations.map((x) => ({ ...x })),
      open_pos: pos.map((p) => ({ po_number: p.po_number, vendor_no: p.vendor_id, qty: p.quantity, eta: p.receipt_date })),
    };
  });

  const leaves = components.filter((x) => !x.is_subassembly);
  const overall = leaves.reduce<Status>((w, x) => (SEVERITY[x.status] < SEVERITY[w] ? x.status : w), "green");

  // Vendor summary: vendors of red/yellow parts.
  const groups = new Map<string, DetailComponent[]>();
  for (const l of leaves.filter((x) => x.status !== "green")) {
    const k = l.vendor_no || "UNASSIGNED";
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const vendor_summary = [...groups.entries()].map(([vno, parts]) => {
    const rel = vno === "UNASSIGNED" ? { pct: null as number | null, src: "", avg: 0 } : reliability(c, vno);
    return {
      vendor_no: vno,
      name: vno === "UNASSIGNED" ? "Unassigned vendor" : (c.vendors.find((v) => v.id === vno)?.name ?? vno),
      parts: parts.map((p) => p.item_no),
      max_lead_time_days: Math.max(0, ...parts.map((p) => p.lead_time_days ?? 0)),
      reliability_pct: rel.pct,
      reliability_source: rel.src,
      avg_overdue_days: rel.avg,
      prices: Object.fromEntries(parts.map((p) => [p.item_no, p.unit_cost])),
      contact: c.sd.contacts[vno] ?? "",
    };
  });

  const own = c.lines.filter((l) => l.fg_item_no === fg);
  const avgPrice = own.length ? own.reduce((s, l) => s + l.unit_price, 0) / own.length : 0;
  const sales_orders = [
    ...own.map((l) => ({
      so_number: l.so_number,
      customer_name: c.customers.find((k) => k.id === l.customer_id)?.name ?? null,
      quantity: l.quantity, delivery_date: l.delivery_date, value: l.quantity * l.unit_price, is_planned: false,
    })),
    ...c.sd.planned_demand.filter((p) => p.item_no === fg).map((p) => ({
      so_number: p.so_number, customer_name: null as string | null, quantity: p.quantity,
      delivery_date: p.month + "-01", value: p.quantity * avgPrice, is_planned: true,
    })),
  ];
  const customers = [...new Set(sales_orders.map((s) => s.customer_name).filter((n): n is string => !!n))];

  return {
    fg_item_no: fg, description: item.description, series: item.series, model: c.sd.models[fg] ?? null,
    customers, bc_demand: d.ordered, planned_demand: d.planned, total_demand: d.total,
    overall, nc_risk_pct: nc, components, vendor_summary, sales_orders,
  };
}

export function supplyStatuses(store: Store): Record<string, Status> {
  const c = ctx(store);
  const out: Record<string, Status> = {};
  for (const f of c.fgs) {
    if (demandSource(c, f.item_no) === "none") continue;
    out[f.item_no] = supplyDetail(store, f.item_no)!.overall;
  }
  return out;
}

// ---- projections and netting orders ----

export interface ProjEvent {
  on_date: string;
  kind: "demand" | "po" | "recommended_po";
  delta: number;
  balance_after: number;
  reference: string;
}
export interface Projection {
  item_no: string;
  description: string;
  opening_inventory: number;
  min_balance: number;
  first_stockout_date: string | null;
  events: ProjEvent[];
}

type RawEvent = Omit<ProjEvent, "balance_after">;

function chain(item: string, description: string, opening: number, raw: RawEvent[]): Projection {
  const order = { demand: 0, po: 1, recommended_po: 2 } as const;
  const sorted = raw
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.on_date.localeCompare(b.e.on_date) || order[a.e.kind] - order[b.e.kind] || a.i - b.i)
    .map((x) => x.e);
  let bal = opening;
  let min = opening;
  let stock: string | null = null;
  const events = sorted.map((e) => {
    bal = round2(bal + e.delta);
    min = Math.min(min, bal);
    if (bal < 0 && !stock) stock = e.on_date;
    return { ...e, balance_after: bal };
  });
  return { item_no: item, description, opening_inventory: opening, min_balance: min, first_stockout_date: stock, events };
}

export function supplyNetting(store: Store) {
  const c = ctx(store);
  const mult = 1 + c.sd.nc_risk_pct / 100;
  const demandEvents = new Map<string, RawEvent[]>();
  const push = (item: string, e: RawEvent) => demandEvents.set(item, [...(demandEvents.get(item) ?? []), e]);

  for (const l of c.lines) {
    const po = c.prods.find((p) => p.so_number === l.so_number);
    const date = po?.start_date ?? l.delivery_date;
    for (const r of bomRows(c, l.fg_item_no).filter((x) => !x.is_subassembly)) {
      push(r.item_no, { on_date: date, kind: "demand", delta: -round2(l.quantity * r.extended_qty * mult), reference: l.so_number });
    }
  }
  for (const p of c.sd.planned_demand) {
    for (const r of bomRows(c, p.item_no).filter((x) => !x.is_subassembly)) {
      push(r.item_no, { on_date: p.month + "-01", kind: "demand", delta: -round2(p.quantity * r.extended_qty * mult), reference: `S&OP plan ${p.month}` });
    }
  }
  for (const l of c.openPos) {
    push(l.component_item_no, { on_date: l.receipt_date, kind: "po", delta: l.quantity, reference: `${l.po_number}/${l.line_no}` });
  }

  const without: Record<string, Projection> = {};
  const withRec: Record<string, Projection> = {};
  for (const comp of c.comps) {
    const raw = demandEvents.get(comp.item_no) ?? [];
    if (!raw.length) continue;
    const base = chain(comp.item_no, comp.description, comp.on_hand, raw);
    without[comp.item_no] = base;
    if (base.first_stockout_date) {
      const params = c.sd.params[comp.item_no];
      const mul = params?.order_multiple ?? 1;
      const qty = Math.ceil(Math.max(-base.min_balance, params?.minimum_order_qty ?? 1) / mul) * mul;
      const date = [addDays(c.today, leadOf(c, comp)), addDays(base.first_stockout_date, -1)].sort().at(-1)!;
      withRec[comp.item_no] = chain(comp.item_no, comp.description, comp.on_hand, [
        ...raw,
        { on_date: date, kind: "recommended_po", delta: qty, reference: `Recommended PO · ${comp.vendor_id || "no vendor"}` },
      ]);
    } else withRec[comp.item_no] = base;
  }

  const seen = new Map<string, number>();
  const orders = [
    ...c.lines.map((l) => {
      const n = (seen.get(l.so_number) ?? 0) + 1;
      seen.set(l.so_number, n);
      const po = c.prods.find((p) => p.so_number === l.so_number);
      const fg = c.fgs.find((f) => f.item_no === l.fg_item_no);
      return {
        so_number: n === 1 ? l.so_number : `${l.so_number}/${l.line_no}`, kind: "sales" as "sales" | "plan",
        item_no: l.fg_item_no, description: fg?.description ?? "",
        customer_name: c.customers.find((k) => k.id === l.customer_id)?.name ?? null,
        series: fg?.series ?? null, model: c.sd.models[l.fg_item_no] ?? null, month: null as string | null,
        quantity: l.quantity, delivery_date: l.delivery_date as string | null, prod_order_no: po?.po_number ?? null,
        bom: bomRows(c, l.fg_item_no),
      };
    }),
    ...c.sd.planned_demand.map((p) => {
      const fg = c.fgs.find((f) => f.item_no === p.item_no);
      return {
        so_number: p.so_number, kind: "plan" as "sales" | "plan", item_no: p.item_no, description: fg?.description ?? "",
        customer_name: null as string | null, series: fg?.series ?? null, model: c.sd.models[p.item_no] ?? null,
        month: p.month as string | null, quantity: p.quantity, delivery_date: (p.month + "-01") as string | null,
        prod_order_no: null as string | null, bom: bomRows(c, p.item_no),
      };
    }),
  ].sort((a, b) => a.so_number.localeCompare(b.so_number));

  return { orders, projections_without: without, projections_with: withRec };
}
