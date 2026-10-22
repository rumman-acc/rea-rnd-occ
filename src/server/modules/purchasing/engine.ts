import { todayIsoDate } from "../../clock";
import { master, type Component } from "../../master";
import type { Store } from "../../store";
import { documents } from "../pricing/data";
import { isActive, open as openPricing } from "../pricing/state";
import { supplyData } from "../supply/data";
import { addDays, supplyDetail, supplyNetting } from "../supply/netting";
import { getPersona } from "./persona";
import type { DemandDetail, Horizon, OpenPoRef, Persona, RecommendationLine } from "./types";

// Rule-based buy engine (REQ-PUR-BR-001..006). Deterministic, no model, no randomness.

const round2 = (v: number) => Math.round(v * 100) / 100;
type Window = Exclude<Horizon, "auto">;
const WINDOW_DAYS: Record<Window, number> = { urgent: 0, "2w": 14, "1m": 30, "3m": 90 };
const ORDER: Window[] = ["urgent", "2w", "1m", "3m"];

interface Ev {
  on_date: string;
  delta: number;
}

interface CompCtx {
  comp: Component;
  vendorName: string;
  status: "red" | "yellow" | "green";
  required: number;
  reserved: number;
  onPo: number;
  opening: number;
  events: Ev[];
  lead: number;
  moq: number;
  mult: number;
  reliabilityPct: number | null;
  delayDays: number;
  openPos: OpenPoRef[];
  demand: DemandDetail[];
  series: string[];
  monthlyUsage: number;
  lastCost: number;
}

interface World {
  today: string;
  items: Map<string, CompCtx>;
  entries: ReturnType<typeof openPricing>["entries"];
}

function reliability(store: Store, today: string, vendorId: string): { pct: number | null; avg: number } {
  const sd = supplyData(store);
  const pos = master(store, "vendor_po_lines").filter((l) => l.vendor_id === vendorId && l.status === "Open");
  const cutoff = addDays(today, -365);
  const hist = sd.receipt_history.filter((r) => r.vendor_id === vendorId && r.received_date >= cutoff);
  const sample = hist.length ? hist.map((r) => [r.need_date, r.received_date] as const) : pos.map((l) => [l.need_date, l.receipt_date] as const);
  if (!sample.length) return { pct: null, avg: 0 };
  const late = sample.filter(([need, got]) => got > need).map(([need, got]) => (Date.parse(got) - Date.parse(need)) / 86400000);
  return {
    pct: Math.round(((sample.length - late.length) / sample.length) * 100),
    avg: late.length ? late.reduce((s, d) => s + d, 0) / late.length : 0,
  };
}

function world(store: Store): World {
  const today = todayIsoDate();
  const sd = supplyData(store);
  const comps = master(store, "components");
  const vendors = master(store, "vendors");
  const fgs = master(store, "fg_items");
  const openLines = master(store, "vendor_po_lines").filter((l) => l.status === "Open");
  const net = supplyNetting(store);
  const details = fgs.map((f) => supplyDetail(store, f.item_no)).filter((d): d is NonNullable<typeof d> => !!d && d.total_demand > 0);
  const invoices = documents(store, "purchase").filter((d) => d.doc_kind === "invoice").sort((a, b) => a.date.localeCompare(b.date));

  const items = new Map<string, CompCtx>();
  for (const comp of comps) {
    const demand: DemandDetail[] = [];
    for (const d of details) {
      const required = round2(d.components.filter((c) => !c.is_subassembly && c.item_no === comp.item_no).reduce((s, c) => s + c.required, 0));
      if (required <= 0) continue;
      demand.push({
        fg_item_no: d.fg_item_no, fg_description: d.description, series: d.series, required,
        sales_orders: d.sales_orders.map((o) => ({ so_number: o.so_number, customer_name: o.customer_name, quantity: o.quantity, delivery_date: o.delivery_date, is_planned: o.is_planned })),
      });
    }
    const required = round2(demand.reduce((s, d) => s + d.required, 0));
    const reservedQty = (sd.reservations[comp.item_no] ?? []).reduce((s, r) => s + r.qty, 0);
    const mine = openLines.filter((l) => l.component_item_no === comp.item_no);
    const onPo = mine.reduce((s, l) => s + l.quantity, 0);
    const netQty = round2(comp.on_hand - reservedQty + onPo - required);
    const status = required <= 0 ? "green" : netQty < 0 ? "red" : comp.on_hand - reservedQty < required ? "yellow" : "green";
    const vendor = vendors.find((v) => v.id === comp.vendor_id);
    const params = sd.params[comp.item_no];
    const rel = comp.vendor_id ? reliability(store, today, comp.vendor_id) : { pct: null, avg: 0 };
    const last = invoices.filter((i) => i.item_no === comp.item_no).at(-1);
    items.set(comp.item_no, {
      comp, vendorName: vendor?.name ?? "", status, required, reserved: reservedQty, onPo,
      opening: comp.on_hand - reservedQty,
      events: (net.projections_without[comp.item_no]?.events ?? []).filter((e) => e.kind !== "recommended_po").map((e) => ({ on_date: e.on_date, delta: e.delta })),
      lead: params?.lead_time_days ?? vendor?.lead_time_days ?? 14,
      moq: params?.minimum_order_qty ?? 1,
      mult: params?.order_multiple ?? 1,
      reliabilityPct: rel.pct,
      delayDays: Math.ceil(rel.avg),
      openPos: mine.map((l) => ({ po_number: l.po_number, vendor_no: l.vendor_id, qty: l.quantity, eta: l.receipt_date })),
      demand,
      series: [...new Set(demand.map((d) => d.series).filter((s): s is string => !!s))].sort(),
      monthlyUsage: Math.round((required / 3) * 10) / 10,
      lastCost: last?.unit_price ?? comp.unit_cost,
    });
  }
  return { today, items, entries: openPricing(store, "purchase").entries };
}

type Entries = ReturnType<typeof openPricing>["entries"];

/** Purchase-book price (REQ-PUR-BR-006). */
function pickPrice(entries: Entries, comp: Component, vendorId: string, qty: number): number {
  const active = entries.filter((e) => e.item_no === comp.item_no && isActive(e) && e.min_qty <= Math.max(qty, 0));
  const pick = (party: string) => active.filter((e) => e.party_no === party).sort((a, b) => b.min_qty - a.min_qty)[0];
  return (pick(vendorId) ?? pick("ALL"))?.price ?? comp.unit_cost;
}
const bookPrice = (w: World, c: CompCtx, qty: number) => pickPrice(w.entries, c.comp, c.comp.vendor_id, qty);

const roundQty = (x: number, c: CompCtx, respectMoq: boolean): number => {
  if (x <= 0) return 0;
  if (!respectMoq) return Math.ceil(x);
  return Math.ceil(Math.max(x, c.moq) / c.mult) * c.mult;
};

/** Shortfall of a window: worst balance from the arrival date to the window end (REQ-PUR-BR-003). */
function shortfall(c: CompCtx, arrival: string, end: string) {
  const bal = (t: string) => c.events.filter((e) => e.on_date <= t).reduce((s, e) => s + e.delta, c.opening);
  const points = [arrival, ...c.events.map((e) => e.on_date).filter((d) => d > arrival && d <= end)];
  const worst = Math.min(...points.map(bal));
  const negative = c.events.map((e) => e.on_date).find((d) => d <= end && bal(d) < 0);
  return { short: round2(Math.max(0, -worst)), needDate: negative ?? arrival };
}

interface Evaluated {
  horizon: Window;
  engineQty: number;
  qty: number;
  netShortfall: number;
  needDate: string;
  delivery: string;
  orderBy: string;
  expedite: boolean;
  flagSoon: boolean;
  effLead: number;
  notes: string[];
}

function evaluate(w: World, c: CompCtx, persona: Persona, horizon: Horizon): Evaluated {
  const effLead = c.lead + c.delayDays;
  const arrival = addDays(w.today, effLead);
  const plainArrival = addDays(w.today, c.lead);
  const windowEnd = (h: Window, lead: number) => addDays(w.today, Math.max(WINDOW_DAYS[h], lead));

  const chosen: Window = horizon === "auto" ? (ORDER.find((h) => shortfall(c, arrival, windowEnd(h, effLead)).short > 0) ?? "3m") : horizon;

  const eng = shortfall(c, arrival, windowEnd(chosen, effLead));
  const engineQty = roundQty(eng.short, c, persona.respect_moq);
  let qty = engineQty;
  let net = eng.short;
  const notes: string[] = [`horizon ${chosen}`];
  if (persona.risk_posture === "lean") {
    const lean = shortfall(c, plainArrival, windowEnd(chosen, c.lead));
    qty = roundQty(lean.short, c, persona.respect_moq);
    notes.push("lean: exact shortfall at plain lead time");
  } else if (persona.risk_posture === "covered" && eng.short > 0) {
    const half = (c.monthlyUsage * c.lead) / 30 / 2;
    qty = roundQty(eng.short + half, c, persona.respect_moq);
    notes.push(`covered: plus half safety stock (${round2(half)})`);
  }
  if (qty === 0) net = 0;
  if (persona.respect_moq && qty > 0) notes.push(`MOQ ${c.moq}, multiple ${c.mult}`);

  const target = addDays(eng.needDate, -persona.delivery_padding_days);
  const delivery = target > arrival ? target : arrival;
  const expedite = qty > 0 && target < arrival;
  const by = addDays(delivery, -effLead);
  const orderBy = by > w.today ? by : w.today;
  const flagSoon = qty > 0 && !expedite && orderBy <= addDays(w.today, 7);
  if (persona.delivery_padding_days) notes.push(`arrive ${persona.delivery_padding_days}d before need`);
  return { horizon: chosen, engineQty, qty, netShortfall: net, needDate: eng.needDate, delivery, orderBy, expedite, flagSoon, effLead, notes };
}

function rationale(c: CompCtx, ev: Evaluated, persona: Persona): string {
  const base = `${c.comp.item_no}: on hand ${c.comp.on_hand} - reserved ${c.reserved} + open POs ${c.onPo} against demand ${c.required}.`;
  if (ev.qty <= 0) {
    return `${base} No shortfall inside the ${ev.horizon} window, so no new order is suggested. Rule-based recommendation, not an AI model.`;
  }
  return (
    `${base} Shortfall ${ev.netShortfall} inside the ${ev.horizon} window; suggested ${ev.qty} (${persona.risk_posture} posture) ` +
    `for delivery ${ev.delivery} (lead ${c.lead}d + vendor delay ${c.delayDays}d)${ev.expedite ? "; stock runs out before a new order can arrive, expedite" : ""}. ` +
    "Rule-based recommendation, not an AI model."
  );
}

export function recommendations(store: Store): RecommendationLine[] {
  const w = world(store);
  const persona = getPersona(store);
  const lines: (RecommendationLine & { net: number })[] = [];
  for (const c of w.items.values()) {
    if (c.status === "green") continue;
    const ev = evaluate(w, c, persona, persona.horizon);
    lines.push({
      supply_status: c.status,
      item_no: c.comp.item_no,
      description: c.comp.description,
      vendor_no: c.comp.vendor_id || "UNASSIGNED",
      vendor_name: c.vendorName,
      vendor_reliability: c.reliabilityPct,
      series: c.series,
      suggested: {
        qty: ev.qty, price: bookPrice(w, c, ev.qty), delivery_date: ev.delivery, preselect: false,
        expedite: ev.expedite, flag_soon: ev.flagSoon, notes: ev.notes,
      },
      engine_qty: ev.engineQty,
      net_shortfall: ev.netShortfall,
      order_by: ev.orderBy,
      delivery_date: ev.delivery,
      open_pos: c.openPos,
      demand_detail: c.demand,
      total_required: c.required,
      on_hand: c.comp.on_hand,
      reserved: c.reserved,
      lead_time_days: ev.effLead,
      reorder_quantity: 0,
      moq: c.moq,
      order_multiple: c.mult,
      last_direct_cost: c.lastCost,
      unit_cost: c.comp.unit_cost,
      monthly_usage: c.monthlyUsage,
      rationale: rationale(c, ev, persona),
      net: c.comp.on_hand - c.reserved + c.onPo - c.required,
    });
  }
  const rank = (l: RecommendationLine) => (l.supply_status === "red" ? 0 : 1);
  return lines
    .sort((a, b) => rank(a) - rank(b) || a.net - b.net || a.item_no.localeCompare(b.item_no))
    .map(({ net: _n, ...l }) => l);
}

/** GET /api/buy-recommendation/{item}?horizon= (REQ-PUR-API-009). Returns null for an unknown component. */
export function buyRecommendation(store: Store, item: string, horizon: Horizon) {
  const w = world(store);
  const c = w.items.get(item);
  if (!c) return null;
  const persona = getPersona(store);
  const ev = evaluate(w, c, persona, horizon);
  return {
    item_no: item,
    vendor_no: c.comp.vendor_id || "UNASSIGNED",
    recommended_qty: ev.qty,
    eta: ev.delivery,
    unit_cost: bookPrice(w, c, ev.qty),
    rationale: rationale(c, ev, persona),
    horizon: ev.horizon,
    expedite: ev.expedite,
    lead_time_days: c.lead,
    vendor_delay_days: c.delayDays,
    effective_lead_days: ev.effLead,
    reliability_pct: c.reliabilityPct,
    order_by: ev.orderBy,
    net_shortfall: ev.netShortfall,
  };
}

/** Price lookup for posted lines without a price (REQ-PUR-BR-007); null for an unknown item. */
export function pricer(store: Store): (item: string, vendorId: string, qty: number) => number | null {
  const entries = openPricing(store, "purchase").entries;
  const comps = new Map(master(store, "components").map((c) => [c.item_no, c]));
  return (item, vendorId, qty) => {
    const comp = comps.get(item);
    return comp ? pickPrice(entries, comp, vendorId, qty) : null;
  };
}
