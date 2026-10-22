import { appendAudit } from "@/server/audit";
import { todayIsoDate } from "@/server/clock";
import { badRequest, notFound } from "@/server/http";
import { master } from "@/server/master";
import type { Store } from "@/server/store";
import { addDays, isWorkday, mondayOf, monthStart, requireDate, round1 } from "./dates";
import {
  adjustmentDoc, isObj, KEYS, requireInt, requireNum, routing, seedRouting, seedWorkCenters, workCenters,
  type Adjustment, type RoutingModels, type WorkCenter,
} from "./data";
import { parseNewOrder, remainingUnits, type NewOrderInput } from "./schedule";

export type Granularity = "week" | "month";

export function parseGranularity(v: unknown): Granularity {
  if (v === undefined || v === null || v === "") return "week";
  if (v === "week" || v === "month") return v;
  throw badRequest("granularity must be 'week' or 'month'");
}

export interface Period {
  key: string;
  label: string;
  start: string;
  end: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** CAP-BR-004 */
export function periods(granularity: Granularity, today: string): Period[] {
  if (granularity === "week") {
    const first = mondayOf(today);
    return Array.from({ length: 12 }, (_, i) => {
      const start = addDays(first, i * 7);
      return { key: start, label: start, start, end: addDays(start, 6) };
    });
  }
  return Array.from({ length: 6 }, (_, i) => {
    const start = monthStart(today, i);
    const end = addDays(monthStart(today, i + 1), -1);
    return { key: start.slice(0, 7), label: `${MONTHS[Number(start.slice(5, 7)) - 1]} ${start.slice(2, 4)}`, start, end };
  });
}

export interface DemandOrder {
  po_number: string;
  fg_item_no: string;
  status: string;
  remaining: number;
  start_date: string;
  end_date: string;
}

/** Non-finished orders of a store with remaining units (CAP-BR-003). */
export function demandOrders(store: Store): DemandOrder[] {
  return master(store, "production_orders")
    .filter((p) => p.status !== "Finished")
    .map((p) => ({ po_number: p.po_number, fg_item_no: p.fg_item_no, status: p.status, remaining: remainingUnits(store, p), start_date: p.start_date, end_date: p.end_date }));
}

function workingWindow(o: DemandOrder, today: string): string[] {
  const from = o.start_date > today ? o.start_date : today;
  const to = o.end_date > from ? o.end_date : from;
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkday(d)) days.push(d);
  return days.length ? days : [from];
}

const bucketKey = (g: Granularity, day: string) => (g === "week" ? mondayOf(day) : day.slice(0, 7));

/** hours per period for one order, per work center and total */
function orderHours(o: DemandOrder, models: RoutingModels, g: Granularity, today: string, keys: Set<string>) {
  const perWc: Record<string, Record<string, number>> = {};
  const row = models[o.fg_item_no] ?? {};
  const days = workingWindow(o, today);
  for (const [wc, hpu] of Object.entries(row)) {
    const total = o.remaining * hpu;
    if (total <= 0) continue;
    for (const d of days) {
      const k = bucketKey(g, d);
      if (!keys.has(k)) continue;
      (perWc[wc] ??= {})[k] = ((perWc[wc] ?? {})[k] ?? 0) + total / days.length;
    }
  }
  return perWc;
}

export interface CapacityCell {
  period: string;
  available_hours: number;
  demand_hours: number;
  utilization_pct: number | null;
  status: "ok" | "tight" | "over";
}

export interface CapacityPlan {
  granularity: Granularity;
  today: string;
  periods: Period[];
  work_centers: Array<{ code: string; name: string; headcount: number; rows: CapacityCell[] }>;
  adjustments: Adjustment[];
  summary: { overloaded: number; peak_utilization_pct: number };
}

export interface CapacityOptions {
  granularity: Granularity;
  headcounts?: Record<string, number>;
  orders?: DemandOrder[];
}

function availableHours(wc: WorkCenter, headcount: number, adj: Adjustment[], p: Period, today: string): number {
  let total = 0;
  for (let d = p.start > today ? p.start : today; d <= p.end; d = addDays(d, 1)) {
    if (!isWorkday(d)) continue;
    const delta = adj.filter((a) => a.work_center === wc.code && a.start_date <= d && d <= a.end_date).reduce((s, a) => s + a.hours_per_day, 0);
    total += Math.max(0, headcount * wc.hours_per_shift + delta);
  }
  return total;
}

export function capacityPlan(store: Store, opts: CapacityOptions): CapacityPlan {
  const today = todayIsoDate();
  const g = opts.granularity;
  const ps = periods(g, today);
  const keys = new Set(ps.map((p) => p.key));
  const wcs = workCenters(store);
  const models = routing(store);
  const adj = adjustmentDoc(store).items;
  const orders = opts.orders ?? demandOrders(store);
  const demand: Record<string, Record<string, number>> = {};
  for (const o of orders) {
    for (const [wc, byPeriod] of Object.entries(orderHours(o, models, g, today, keys))) {
      for (const [k, h] of Object.entries(byPeriod)) ((demand[wc] ??= {})[k] = (demand[wc][k] ?? 0) + h);
    }
  }
  let overloaded = 0;
  let peak = 0;
  const work_centers = wcs.map((wc) => {
    const hc = opts.headcounts?.[wc.code] ?? wc.headcount;
    const rows = ps.map<CapacityCell>((p) => {
      const available = availableHours(wc, hc, adj, p, today);
      const dem = demand[wc.code]?.[p.key] ?? 0;
      const util = available > 0 ? round1((dem / available) * 100) : dem > 0 ? null : 0;
      const status = util === null || util > 100 ? "over" : util > 85 ? "tight" : "ok";
      if (status === "over") overloaded++;
      if (util !== null) peak = Math.max(peak, util);
      return { period: p.key, available_hours: round1(available), demand_hours: round1(dem), utilization_pct: util, status };
    });
    return { code: wc.code, name: wc.name, headcount: hc, rows };
  });
  return { granularity: g, today, periods: ps, work_centers, adjustments: adj, summary: { overloaded, peak_utilization_pct: peak } };
}

export function capacityDemand(store: Store, g: Granularity) {
  const today = todayIsoDate();
  const ps = periods(g, today);
  const keys = new Set(ps.map((p) => p.key));
  const models = routing(store);
  const orders = demandOrders(store)
    .map((o) => {
      const hours: Record<string, number> = {};
      for (const byPeriod of Object.values(orderHours(o, models, g, today, keys))) for (const [k, h] of Object.entries(byPeriod)) hours[k] = (hours[k] ?? 0) + h;
      for (const k of Object.keys(hours)) hours[k] = round1(hours[k]);
      return {
        po_number: o.po_number, item_no: o.fg_item_no, model: o.fg_item_no, status: o.status,
        remaining_units: o.remaining, start_date: o.start_date, end_date: o.end_date,
        hours, total_hours: round1(Object.values(hours).reduce((s, h) => s + h, 0)),
      };
    })
    .filter((o) => o.total_hours > 0);
  return { granularity: g, periods: ps, orders };
}

/** Flattened weekly rows for Plan.capacity in a simulated plan (SIM-005). */
export function capacityRows(store: Store, headcounts?: Record<string, number>) {
  const plan = capacityPlan(store, { granularity: "week", headcounts });
  return plan.work_centers.flatMap((wc) => wc.rows.map((r) => ({ work_center: wc.code, ...r })));
}

export function parseHeadcounts(store: Store, raw: unknown, field = "headcounts"): Record<string, number> {
  if (raw === undefined || raw === null) return {};
  if (!isObj(raw)) throw badRequest(`${field} must be an object`);
  const codes = new Set(workCenters(store).map((w) => w.code));
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!codes.has(k)) throw notFound(`work center ${k} not found`);
    out[k] = requireInt(v, `${field}.${k}`, 0, 500);
  }
  return out;
}

export function runScenario(store: Store, body: Record<string, unknown>) {
  const g = parseGranularity(body.granularity);
  const headcounts = parseHeadcounts(store, body.headcounts);
  const base = demandOrders(store);
  const byPo = new Map(base.map((o) => [o.po_number, o]));
  const findPo = (po: string) => byPo.get(po) ?? (() => { throw notFound(`production order ${po} not found (or finished)`); })();
  let orders: DemandOrder[] = base.map((o) => ({ ...o }));
  const pick = (po: string) => orders.find((o) => o.po_number === findPo(po).po_number)!;

  const dates = body.po_dates ?? {};
  if (!isObj(dates)) throw badRequest("po_dates must be an object");
  for (const [po, v] of Object.entries(dates)) {
    if (!isObj(v)) throw badRequest(`po_dates.${po} must be an object`);
    const o = pick(po);
    const s = v.start_date === undefined ? o.start_date : requireDate(v.start_date, `po_dates.${po}.start_date`);
    const e = v.end_date === undefined ? o.end_date : requireDate(v.end_date, `po_dates.${po}.end_date`);
    if (e < s) throw badRequest(`po_dates.${po}: end_date must not be before start_date`);
    o.start_date = s;
    o.end_date = e;
  }
  const shifts = body.po_shifts ?? {};
  if (!isObj(shifts)) throw badRequest("po_shifts must be an object");
  for (const [po, v] of Object.entries(shifts)) {
    const n = requireInt(v, `po_shifts.${po}`, -365, 365);
    const o = pick(po);
    o.start_date = addDays(o.start_date, n);
    o.end_date = addDays(o.end_date, n);
  }
  const qtys = body.po_quantities ?? {};
  if (!isObj(qtys)) throw badRequest("po_quantities must be an object");
  for (const [po, v] of Object.entries(qtys)) pick(po).remaining = requireNum(v, `po_quantities.${po}`, 0.1, 1e6);

  const news = body.new_orders ?? [];
  if (!Array.isArray(news)) throw badRequest("new_orders must be an array");
  const taken = new Set(master(store, "production_orders").map((p) => p.po_number));
  for (const raw of news) {
    const n: NewOrderInput = parseNewOrder(store, raw, taken);
    taken.add(n.name);
    orders = [...orders, { po_number: n.name, fg_item_no: n.fg_item_no, status: "Planned", remaining: n.quantity, start_date: n.start_date, end_date: n.end_date }];
  }

  const baseline = capacityPlan(store, { granularity: g });
  const scenario = capacityPlan(store, { granularity: g, headcounts, orders });
  return {
    granularity: g,
    periods: baseline.periods,
    baseline,
    scenario,
    delta: {
      overloaded_before: baseline.summary.overloaded,
      overloaded_after: scenario.summary.overloaded,
      peak_before: baseline.summary.peak_utilization_pct,
      peak_after: scenario.summary.peak_utilization_pct,
    },
  };
}

// ---- writes ----

export function addAdjustment(store: Store, actor: string, body: Record<string, unknown>): Adjustment {
  const wc = typeof body.work_center === "string" ? body.work_center : "";
  if (!workCenters(store).some((w) => w.code === wc)) throw notFound(`work center ${wc || "(missing)"} not found`);
  const start = requireDate(body.start_date, "start_date");
  const end = requireDate(body.end_date, "end_date");
  if (end < start) throw badRequest("end_date must not be before start_date");
  const hours = requireNum(body.hours_per_day, "hours_per_day", -24 * 500, 24 * 500);
  if (hours === 0) throw badRequest("hours_per_day must not be 0");
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : "";
  const item = store.update(KEYS.adjustments, () => ({ next_id: 1, items: [] as Adjustment[] }), (d) => {
    const a: Adjustment = { id: d.next_id++, work_center: wc, start_date: start, end_date: end, hours_per_day: hours, reason };
    d.items.push(a);
    return a;
  });
  appendAudit(store, { source: "production", actor, action: "adjustment.add", detail: `#${item.id} ${wc} ${start}..${end} ${hours}h/day ${reason}`.trim() });
  return item;
}

export function deleteAdjustment(store: Store, actor: string, id: number): void {
  const found = adjustmentDoc(store).items.some((a) => a.id === id);
  if (!found) throw notFound(`adjustment ${id} not found`);
  store.update(KEYS.adjustments, () => ({ next_id: 1, items: [] as Adjustment[] }), (d) => void (d.items = d.items.filter((a) => a.id !== id)));
  appendAudit(store, { source: "production", actor, action: "adjustment.delete", detail: `#${id}` });
}

export function putHeadcounts(store: Store, actor: string, body: Record<string, unknown>): WorkCenter[] {
  if (!isObj(body.headcounts)) throw badRequest("headcounts must be an object");
  const hc = parseHeadcounts(store, body.headcounts);
  const out = store.update(KEYS.workcenters, seedWorkCenters, (d) => {
    for (const w of d) if (hc[w.code] !== undefined) w.headcount = hc[w.code];
    return d.map((w) => ({ ...w }));
  });
  appendAudit(store, { source: "production", actor, action: "headcounts.update", detail: Object.entries(hc).map(([k, v]) => `${k}=${v}`).join(", ") });
  return out;
}

export function putRouting(store: Store, actor: string, body: Record<string, unknown>) {
  if (!isObj(body.models)) throw badRequest("models must be an object");
  const codes = new Set(workCenters(store).map((w) => w.code));
  const items = new Set(master(store, "fg_items").map((i) => i.item_no));
  const next: RoutingModels = {};
  for (const [model, row] of Object.entries(body.models)) {
    if (!items.has(model)) throw badRequest(`unknown model ${model}`);
    if (!isObj(row)) throw badRequest(`models.${model} must be an object`);
    next[model] = {};
    for (const [wc, h] of Object.entries(row)) {
      if (!codes.has(wc)) throw badRequest(`unknown work center ${wc}`);
      next[model][wc] = requireNum(h, `models.${model}.${wc}`, 0, 10000);
    }
  }
  store.update(KEYS.routing, seedRouting, (d) => void Object.assign(d, next));
  appendAudit(store, { source: "production", actor, action: "routing.update", detail: `models: ${Object.keys(next).join(", ")}` });
  return routingView(store);
}

export function routingView(store: Store) {
  return {
    models: routing(store),
    work_centers: workCenters(store).map((w) => w.code),
    items: master(store, "fg_items").map((i) => ({ item_no: i.item_no, description: i.description })),
  };
}

