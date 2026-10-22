import { appendAudit } from "../../audit";
import { nowIso, todayIsoDate } from "../../clock";
import { badRequest, notFound } from "../../http";
import { master, updateMaster, type VendorPoLine } from "../../master";
import type { Store } from "../../store";
import { documents } from "../pricing/data";
import { KEYS as WH_KEYS } from "../warehouse/seed";
import { addDays, supplyNetting } from "../supply/netting";
import { pricer } from "./engine";
import type { AppPo, PoHistoryEntry, PoLineRec, PostLineIn } from "./types";

const POS_KEY = "purchasing:pos";
const HISTORY_KEY = "purchasing:po-history";

const round2 = (v: number) => Math.round(v * 100) / 100;
function isDate(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(s + "T00:00:00Z");
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
}

const appPos = (s: Store) => s.get<AppPo[]>(POS_KEY, () => []);
const history = (s: Store) => s.get<PoHistoryEntry[]>(HISTORY_KEY, () => []);

function journal(s: Store, e: Omit<PoHistoryEntry, "id" | "ts">): PoHistoryEntry {
  return s.update<PoHistoryEntry[], PoHistoryEntry>(HISTORY_KEY, () => [], (log) => {
    const entry = { id: (log.at(-1)?.id ?? 0) + 1, ts: nowIso().slice(0, 19), ...e };
    log.push(entry);
    return entry;
  });
}

/** POST /api/cockpit/post-pos (REQ-PUR-API-004, REQ-PUR-BR-007). */
export function postPos(store: Store, actor: string, body: Record<string, unknown>) {
  const operator = (typeof body.operator === "string" && body.operator.trim()) || actor;
  const raw = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]) : [];
  if (raw.length === 0) throw badRequest("At least one line is required");
  const comps = new Map(master(store, "components").map((c) => [c.item_no, c]));
  const priceOf = pricer(store);

  const lines: (PostLineIn & { price: number })[] = raw.map((l, i) => {
    const item = String(l?.item_no ?? "");
    if (!comps.has(item)) throw badRequest(`Line ${i + 1}: unknown item "${item}"`);
    const qty = l.qty;
    if (typeof qty !== "number" || !Number.isFinite(qty) || !(qty > 0)) throw badRequest(`Line ${i + 1}: qty for ${item} must be greater than 0`);
    if (!isDate(l.delivery_date)) throw badRequest(`Line ${i + 1}: delivery_date for ${item} must be a valid YYYY-MM-DD date`);
    const vendor = typeof l.vendor_no === "string" ? l.vendor_no.trim() : "";
    let price = l.price;
    if (price === null || price === undefined || price === 0) price = priceOf(item, vendor, qty) ?? comps.get(item)!.unit_cost;
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) throw badRequest(`Line ${i + 1}: price for ${item} must be 0 or more`);
    return { item_no: item, vendor_no: vendor, vendor_name: typeof l.vendor_name === "string" ? l.vendor_name : "", qty, price, delivery_date: l.delivery_date };
  });

  const vendors = master(store, "vendors");
  const groups = new Map<string, (PostLineIn & { price: number })[]>();
  for (const l of lines) groups.set(l.vendor_no, [...(groups.get(l.vendor_no) ?? []), l]);

  const results: Record<string, unknown>[] = [];
  const created: { vendorId: string; ls: (PostLineIn & { price: number })[] }[] = [];
  for (const [vno, ls] of groups) {
    const vendor = vendors.find((v) => v.id === vno);
    if (vendor) created.push({ vendorId: vno, ls });
    else {
      const error = vno && vno !== "UNASSIGNED" ? `Unknown vendor "${vno}"` : "No vendor assigned to this item";
      const recs: PoLineRec[] = ls.map((l) => ({ item_no: l.item_no, qty: l.qty, price: l.price }));
      const e = journal(store, { operator, po_number: null, vendor_no: vno || "UNASSIGNED", vendor_name: ls[0].vendor_name ?? "", amount: null, lines: recs, status: "failed", error });
      appendAudit(store, { source: "purchasing", actor: operator, action: "Purchase order failed", detail: `${vno || "UNASSIGNED"} · ${error}` });
      results.push({ id: e.id, status: "failed", po_number: null, vendor_no: e.vendor_no, vendor_name: e.vendor_name, amount: null, delivery_date: null, lines: recs, error });
    }
  }

  if (created.length) {
    const numbers = updateMaster(store, "vendor_po_lines", (all) => {
      let seq = Math.max(1000, ...all.map((p) => Number(/^V-PO-B(\d+)$/.exec(p.po_number)?.[1] ?? 0)));
      return created.map(({ vendorId, ls }) => {
        const no = `V-PO-B${++seq}`;
        ls.forEach((l, i) =>
          all.push({
            po_number: no, line_no: String(i + 1), vendor_id: vendorId, component_item_no: l.item_no,
            quantity: l.qty, need_date: l.delivery_date, receipt_date: l.delivery_date, status: "Open",
          } satisfies VendorPoLine),
        );
        return no;
      });
    });
    created.forEach(({ vendorId, ls }, i) => {
      const vendor = vendors.find((v) => v.id === vendorId)!;
      const recs: PoLineRec[] = ls.map((l) => ({ item_no: l.item_no, qty: l.qty, price: l.price }));
      const amount = round2(ls.reduce((s, l) => s + l.qty * l.price, 0));
      const delivery = ls.map((l) => l.delivery_date).sort()[0];
      store.update<AppPo[]>(POS_KEY, () => [], (all) => {
        all.push({ po_number: numbers[i], vendor_id: vendorId, created_at: nowIso().slice(0, 19), operator, amount, lines: recs });
      });
      const e = journal(store, { operator, po_number: numbers[i], vendor_no: vendorId, vendor_name: vendor.name, amount, lines: recs, status: "created" });
      appendAudit(store, {
        source: "purchasing", actor: operator, action: "Purchase order created",
        detail: `${numbers[i]} · ${vendorId} · ${recs.map((l) => `${l.item_no} x${l.qty}`).join(", ")} · ${amount}`,
      });
      results.push({ id: e.id, status: "created", po_number: numbers[i], vendor_no: vendorId, vendor_name: vendor.name, amount, delivery_date: delivery, lines: recs });
    });
  }
  return results;
}

export const poHistory = (store: Store): PoHistoryEntry[] => history(store).reverse();

interface LineState {
  ordered: number;
  received: number;
}
const received = (store: Store) => store.get<Record<string, LineState>>(WH_KEYS.lines, () => ({}));

function priceMap(store: Store): (l: VendorPoLine) => number {
  const posted = new Map<string, number>();
  for (const p of appPos(store)) p.lines.forEach((l, i) => posted.set(`${p.po_number}/${i + 1}`, l.price));
  const cost = new Map(master(store, "components").map((c) => [c.item_no, c.unit_cost]));
  return (l) => posted.get(`${l.po_number}/${l.line_no}`) ?? cost.get(l.component_item_no) ?? 0;
}

/** GET /api/cockpit/open-pos (REQ-PUR-API-005, REQ-PUR-DAT-004). */
export function openPos(store: Store) {
  const all = master(store, "vendor_po_lines");
  const vendors = master(store, "vendors");
  const mine = new Map(appPos(store).map((p) => [p.po_number, p]));
  const states = received(store);
  const price = priceMap(store);
  const today = todayIsoDate();
  const byPo = new Map<string, VendorPoLine[]>();
  for (const l of all) byPo.set(l.po_number, [...(byPo.get(l.po_number) ?? []), l]);

  return [...byPo.entries()]
    .filter(([, ls]) => ls.some((l) => l.status === "Open"))
    .map(([po, ls]) => {
      const vendor = vendors.find((v) => v.id === ls[0].vendor_id);
      const own = mine.get(po);
      const earliest = ls.map((l) => l.receipt_date).sort()[0];
      const guess = addDays(earliest, -(vendor?.lead_time_days ?? 14));
      return {
        po_number: po,
        vendor_no: ls[0].vendor_id,
        vendor_name: vendor?.name ?? ls[0].vendor_id,
        order_date: own ? own.created_at.slice(0, 10) : guess > today ? today : guess,
        status: own ? "Open" : "Released",
        amount: round2(ls.reduce((s, l) => s + l.quantity * price(l), 0)),
        qty_ordered: ls.reduce((s, l) => s + l.quantity, 0),
        qty_received: ls.reduce((s, l) => s + (l.status === "Received" ? l.quantity : (states[`${l.po_number}/${l.line_no}`]?.received ?? 0)), 0),
        lines: ls.length,
        items: [...new Set(ls.map((l) => l.component_item_no))].join(", "),
      };
    })
    .sort((a, b) => a.order_date.localeCompare(b.order_date) || a.po_number.localeCompare(b.po_number));
}

/** GET /api/purchase-history (REQ-PUR-API-007, REQ-PUR-DAT-005). */
export function purchaseHistory(store: Store) {
  const comps = new Map(master(store, "components").map((c) => [c.item_no, c]));
  const vendors = new Map(master(store, "vendors").map((v) => [v.id, v.name]));
  const states = received(store);
  const price = priceMap(store);
  const entries: Record<string, unknown>[] = [];

  for (const l of master(store, "vendor_po_lines")) {
    const done = l.status === "Received";
    const got = done ? l.quantity : (states[`${l.po_number}/${l.line_no}`]?.received ?? 0);
    const p = price(l);
    entries.push({
      po_number: l.po_number, vendor_no: l.vendor_id, vendor_name: vendors.get(l.vendor_id) ?? l.vendor_id,
      item_no: l.component_item_no, description: comps.get(l.component_item_no)?.description ?? "", series: "", model: "",
      expected_date: l.receipt_date, first_invoice_date: done ? l.receipt_date : null, last_invoice_date: done ? l.receipt_date : null,
      qty_ordered: l.quantity, qty_received: got, amount_ordered: round2(l.quantity * p), amount_received: round2(got * p),
      status: done ? "completed" : "open",
    });
  }
  documents(store, "purchase")
    .filter((d) => d.doc_kind === "invoice")
    .forEach((d, i) => {
      entries.push({
        po_number: `V-PO-H${i + 1}`, vendor_no: d.party_no, vendor_name: d.party_name, item_no: d.item_no, description: d.description,
        series: "", model: "", expected_date: addDays(d.date, -3), first_invoice_date: d.date, last_invoice_date: d.date,
        qty_ordered: d.qty, qty_received: d.qty, amount_ordered: round2(d.qty * d.unit_price), amount_received: round2(d.qty * d.unit_price),
        status: "completed",
      });
    });
  return { entries };
}

/** GET /api/plan/projection/{item}?with_recommendations= (REQ-PUR-API-008). */
export function projection(store: Store, item: string, withRecommendations: boolean) {
  const n = supplyNetting(store);
  const p = (withRecommendations ? n.projections_with : n.projections_without)[item];
  if (!p) throw notFound(`No projection for item "${item}"`);
  return p;
}
