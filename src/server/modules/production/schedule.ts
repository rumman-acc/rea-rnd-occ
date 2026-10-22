import { appendAudit } from "@/server/audit";
import { todayIsoDate } from "@/server/clock";
import { badRequest, conflict, notFound } from "@/server/http";
import { master, updateMaster, type ProductionOrder } from "@/server/master";
import { planLines } from "@/server/plan";
import type { Store } from "@/server/store";
import { diffDays, requireDate, round1 } from "./dates";
import { isObj, KEYS, progress, progressSeed, requireInt } from "./data";

export interface LinkageRow {
  so_number: string;
  item_no: string;
  customer_name: string | null;
  series: string | null;
  model: string;
  delivery_date: string | null;
  quantity: number;
  unit_price: number;
  health: "green" | "yellow" | "red";
  prod_order_no: string | null;
  prod_start: string | null;
  prod_end: string | null;
  prod_pct_complete: number | null;
  buffer_days: number | null;
}

export const pctOf = (store: Store, po: ProductionOrder): number =>
  po.status === "Finished" ? 100 : (progress(store)[po.po_number] ?? 0);

/** Remaining units = quantity x (100 - pct)/100, 1 decimal (PRD-BR-003). */
export const remainingUnits = (store: Store, po: ProductionOrder): number => round1((po.quantity * (100 - pctOf(store, po))) / 100);

export function linkageRows(store: Store): LinkageRow[] {
  const lines = master(store, "sales_lines");
  const pos = master(store, "production_orders");
  return planLines(store).map((l) => {
    const sl = lines.find((x) => x.so_number === l.so_number && x.line_no === l.item_no);
    const po = pos.find((p) => p.po_number === l.linked_po) ?? null;
    return {
      so_number: l.so_number,
      item_no: l.item_no,
      customer_name: l.customer_name,
      series: l.series,
      model: sl?.fg_item_no ?? "",
      delivery_date: l.delivery_date,
      quantity: l.quantity,
      unit_price: l.unit_price,
      health: l.health,
      prod_order_no: po?.po_number ?? null,
      prod_start: po?.start_date ?? null,
      prod_end: po?.end_date ?? null,
      prod_pct_complete: po ? pctOf(store, po) : null,
      buffer_days: po && l.delivery_date ? diffDays(po.end_date, l.delivery_date.slice(0, 10)) : null,
    };
  });
}

export function linkage(store: Store) {
  return { rows: linkageRows(store), warnings: [] as Array<{ code: string; message: string }> };
}

export function releasedOrders(store: Store) {
  const rows = linkageRows(store);
  const items = master(store, "fg_items");
  return master(store, "production_orders")
    .filter((p) => p.status === "Released")
    .map((p) => {
      const r = rows.find((x) => x.prod_order_no === p.po_number);
      return {
        po_number: p.po_number,
        so_number: p.so_number,
        customer_name: r?.customer_name ?? "",
        item_no: p.fg_item_no,
        series: items.find((i) => i.item_no === p.fg_item_no)?.series ?? "",
        model: p.fg_item_no,
        start_date: p.start_date,
        end_date: p.end_date,
        quantity: remainingUnits(store, p),
        pct_complete: pctOf(store, p),
        delivery_date: r?.delivery_date ?? null,
        health: r?.health ?? null,
        linked: !!r,
      };
    });
}

/** Everything the Gantt page draws. `base` is the real store when `store` is a simulated copy. */
export function scheduleView(store: Store, base: Store = store) {
  const rows = linkageRows(store);
  const baseOrders = new Map(master(base, "production_orders").map((p) => [p.po_number, p]));
  const orders = master(store, "production_orders").map((p) => {
    const r = rows.find((x) => x.prod_order_no === p.po_number);
    const b = baseOrders.get(p.po_number);
    return {
      po_number: p.po_number,
      so_number: p.so_number,
      fg_item_no: p.fg_item_no,
      model: p.fg_item_no,
      quantity: p.quantity,
      start_date: p.start_date,
      end_date: p.end_date,
      status: p.status,
      pct_complete: pctOf(store, p),
      customer_name: r?.customer_name ?? null,
      delivery_date: r?.delivery_date ?? null,
      buffer_days: r?.buffer_days ?? null,
      health: r?.health ?? null,
      simulated: !b,
      changed: !!b && (b.start_date !== p.start_date || b.end_date !== p.end_date),
    };
  });
  const linked = new Set(rows.filter((r) => r.prod_order_no).map((r) => r.so_number));
  return {
    today: todayIsoDate(),
    orders,
    lines: rows,
    fg_items: master(store, "fg_items").map((i) => ({ item_no: i.item_no, description: i.description })),
    unlinked_sos: [...new Set(rows.filter((r) => !linked.has(r.so_number)).map((r) => r.so_number))],
  };
}

// ---- input validation shared by simulation, scenario and real writes ----

export interface NewOrderInput {
  name: string;
  fg_item_no: string;
  quantity: number;
  so_number?: string | null;
  start_date: string;
  end_date: string;
}

export function parseNewOrder(store: Store, raw: unknown, taken: Set<string>): NewOrderInput {
  if (!isObj(raw)) throw badRequest("new order must be an object");
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) throw badRequest("new order name is required");
  if (taken.has(name)) throw badRequest(`order number ${name} already exists`);
  const fg = raw.fg_item_no;
  if (typeof fg !== "string" || !master(store, "fg_items").some((i) => i.item_no === fg)) throw badRequest("unknown fg_item_no");
  if (typeof raw.quantity !== "number" || !(raw.quantity > 0) || !Number.isFinite(raw.quantity)) throw badRequest("quantity must be greater than 0");
  const start = requireDate(raw.start_date, "start_date");
  const end = requireDate(raw.end_date, "end_date");
  if (end < start) throw badRequest("end_date must not be before start_date");
  const so = raw.so_number == null || raw.so_number === "" ? null : String(raw.so_number);
  if (so && !master(store, "sales_lines").some((l) => l.so_number === so)) throw badRequest(`unknown so_number ${so}`);
  return { name, fg_item_no: fg, quantity: raw.quantity, so_number: so, start_date: start, end_date: end };
}

export function parseDates(raw: Record<string, unknown>, current: { start_date: string; end_date: string }) {
  const hasS = raw.start_date !== undefined && raw.start_date !== null;
  const hasE = raw.end_date !== undefined && raw.end_date !== null;
  if (!hasS && !hasE) throw badRequest("start_date or end_date is required");
  const start = hasS ? requireDate(raw.start_date, "start_date") : current.start_date;
  const end = hasE ? requireDate(raw.end_date, "end_date") : current.end_date;
  if (end < start) throw badRequest("end_date must not be before start_date");
  return { start_date: start, end_date: end };
}

export function addOrder(store: Store, o: NewOrderInput, poNumber: string): ProductionOrder {
  const po: ProductionOrder = {
    po_number: poNumber,
    so_number: o.so_number ?? null,
    fg_item_no: o.fg_item_no,
    quantity: o.quantity,
    start_date: o.start_date,
    end_date: o.end_date,
    status: "Planned",
  };
  updateMaster(store, "production_orders", (d) => void d.push(po));
  return po;
}

export function applyReschedule(store: Store, poNumber: string, raw: Record<string, unknown>): ProductionOrder {
  const cur = master(store, "production_orders").find((p) => p.po_number === poNumber);
  if (!cur) throw notFound(`production order ${poNumber} not found`);
  if (cur.status === "Finished") throw conflict(`${poNumber} is finished`);
  const dates = parseDates(raw, cur);
  return updateMaster(store, "production_orders", (d) => {
    const p = d.find((x) => x.po_number === poNumber)!;
    Object.assign(p, dates);
    return { ...p };
  });
}

// ---- real mutations (audited) ----

export function nextPoNumber(store: Store): string {
  const max = master(store, "production_orders").reduce((m, p) => {
    const n = /^P-ORD(\d+)$/.exec(p.po_number);
    return n ? Math.max(m, Number(n[1])) : m;
  }, 201000);
  return `P-ORD${max + 1}`;
}

export function createOrder(store: Store, actor: string, raw: Record<string, unknown>): ProductionOrder {
  const po = nextPoNumber(store);
  const taken = new Set(master(store, "production_orders").map((p) => p.po_number));
  const input = parseNewOrder(store, { ...raw, name: po }, taken);
  const created = addOrder(store, input, po);
  appendAudit(store, {
    source: "production",
    actor,
    action: "order.create",
    detail: `${po} ${input.fg_item_no} x${input.quantity} ${input.start_date}..${input.end_date}${input.so_number ? ` for ${input.so_number}` : ""}`,
  });
  return created;
}

function transition(store: Store, actor: string, poNumber: string, from: ProductionOrder["status"], to: ProductionOrder["status"], action: string) {
  const cur = master(store, "production_orders").find((p) => p.po_number === poNumber);
  if (!cur) throw notFound(`production order ${poNumber} not found`);
  if (cur.status !== from) throw conflict(`${poNumber} is ${cur.status}; only ${from} orders can be ${to === "Released" ? "released" : "finished"}`);
  updateMaster(store, "production_orders", (d) => void (d.find((x) => x.po_number === poNumber)!.status = to));
  if (to === "Finished") store.update(KEYS.progress, progressSeed, (d) => void (d[poNumber] = 100));
  appendAudit(store, { source: "production", actor, action, detail: `${poNumber} ${from} -> ${to}` });
  return master(store, "production_orders").find((p) => p.po_number === poNumber)!;
}

export const releaseOrder = (s: Store, a: string, po: string) => transition(s, a, po, "Planned", "Released", "order.release");
export const finishOrder = (s: Store, a: string, po: string) => transition(s, a, po, "Released", "Finished", "order.finish");

export function rescheduleOrder(store: Store, actor: string, po: string, raw: Record<string, unknown>) {
  if (raw.start_date == null || raw.end_date == null) throw badRequest("start_date and end_date are required");
  const p = applyReschedule(store, po, raw);
  appendAudit(store, { source: "production", actor, action: "order.reschedule", detail: `${po} ${p.start_date}..${p.end_date}` });
  return p;
}

export function setProgress(store: Store, actor: string, po: string, raw: Record<string, unknown>) {
  const cur = master(store, "production_orders").find((p) => p.po_number === po);
  if (!cur) throw notFound(`production order ${po} not found`);
  const pct = requireInt(raw.pct, "pct", 0, 100);
  if (cur.status !== "Released") throw conflict(`${po} is ${cur.status}; progress can only be set on released orders`);
  store.update(KEYS.progress, progressSeed, (d) => void (d[po] = pct));
  appendAudit(store, { source: "production", actor, action: "order.progress", detail: `${po} ${pct}%` });
  return { po_number: po, pct_complete: pct };
}
