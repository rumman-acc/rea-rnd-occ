import { appendAudit } from "../../audit";
import { nowIso, todayIsoDate } from "../../clock";
import { badRequest, notFound } from "../../http";
import { master, updateMaster, type VendorPoLine } from "../../master";
import type { Store } from "../../store";
import { DEFAULT_BIN, FALLBACK_BIN, KEYS, LOCATION, LOT_TRACKED, seedBins, seedLegacy, seedSettings, seedStock } from "./seed";
import type { Bin, HistoryEntry, HistoryLine, LegacyPo, LineState, StockRow, WhSettings } from "./types";

const EPS = 1e-9;
const SCANNER_MODES = ["keyboard-wedge", "serial", "camera"];
const SYMBOLOGIES = ["code128", "code39", "qr", "datamatrix"];

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export const getBins = (s: Store): Bin[] => s.get(KEYS.bins, seedBins).sort((a, b) => a.zone.localeCompare(b.zone) || a.code.localeCompare(b.code));
const getStock = (s: Store) => s.get<StockRow[]>(KEYS.stock, () => seedStock(s));
const getLineStates = (s: Store) => s.get<Record<string, LineState>>(KEYS.lines, () => ({}));
export const getSettings = (s: Store): WhSettings => s.get(KEYS.settings, seedSettings);
const history = (s: Store) => s.get<HistoryEntry[]>(KEYS.history, () => []);

const lineKey = (l: { po_number: string; line_no: string }) => `${l.po_number}/${l.line_no}`;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const operatorOf = (v: unknown, actor: string) => str(v) || actor;
const isDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

function stateOf(states: Record<string, LineState>, l: VendorPoLine): LineState {
  return states[lineKey(l)] ?? { ordered: l.quantity, received: 0 };
}

function journal(s: Store, e: Omit<HistoryEntry, "id" | "ts">): HistoryEntry {
  return s.update<HistoryEntry[], HistoryEntry>(KEYS.history, () => [], (log) => {
    const entry = { id: (log.at(-1)?.id ?? 0) + 1, ts: nowIso().slice(0, 19), ...e };
    log.push(entry);
    return entry;
  });
}

const audit = (s: Store, actor: string, action: string, detail: string) => appendAudit(s, { source: "warehouse", actor, action, detail });

function receivedJournal(s: Store, poNumber: string) {
  return history(s)
    .filter((h) => h.type === "receipt" && h.status === "posted" && h.po_number === poNumber)
    .flatMap((h) => (h.lines ?? []).map((l) => ({ receipt_date: h.receipt_date ?? h.ts.slice(0, 10), item_no: l.item_no, qty: l.qty, lot_no: l.lot_no, bin_code: l.bin_code, operator: h.operator })));
}

const describe = (s: Store, item: string) => master(s, "components").find((c) => c.item_no === item)?.description ?? item;

function groupByPo(s: Store) {
  const byPo = new Map<string, VendorPoLine[]>();
  for (const l of master(s, "vendor_po_lines")) byPo.set(l.po_number, [...(byPo.get(l.po_number) ?? []), l]);
  return byPo;
}

export function receivingTodo(s: Store) {
  const states = getLineStates(s);
  const today = todayIsoDate();
  const vendors = master(s, "vendors");
  const dates = s.get<Record<string, string>>(KEYS.poDates, () => ({}));
  const pos = [...groupByPo(s).entries()]
    .filter(([, ls]) => ls.some((l) => l.status === "Open"))
    .map(([po, all]) => {
      const open = all.filter((l) => l.status === "Open");
      const expected = open.map((l) => l.receipt_date).sort()[0];
      return {
        po_id: po,
        po_number: po,
        vendor_no: open[0].vendor_id,
        vendor_name: vendors.find((x) => x.id === open[0].vendor_id)?.name ?? open[0].vendor_id,
        expected_date: expected,
        posting_date: dates[po] ?? expected,
        status: "Released",
        releasable: true,
        lines: open.map((l) => {
          const st = stateOf(states, l);
          return {
            line_id: lineKey(l),
            sequence: Number(l.line_no) || 0,
            item_no: l.component_item_no,
            description: describe(s, l.component_item_no),
            ordered: st.ordered,
            received: st.received,
            outstanding: st.ordered - st.received,
            suggested_bin: DEFAULT_BIN[l.component_item_no] ?? FALLBACK_BIN,
            lot_required: LOT_TRACKED.has(l.component_item_no),
            overdue: l.receipt_date < today,
            expected_date: l.receipt_date,
          };
        }),
        received_lines: receivedJournal(s, po),
      };
    })
    .sort((a, b) => a.expected_date.localeCompare(b.expected_date) || a.po_number.localeCompare(b.po_number));
  return { pos, al_mode: true, location: LOCATION, settings: { over_delivery_tolerance_pct: getSettings(s).over_delivery_tolerance_pct } };
}

interface ReceiptLineIn {
  line_id: string;
  item_no: string;
  qty: number;
  lot_no: string;
  bin_code: string;
  close_line: boolean;
}

function addStock(rows: StockRow[], item: string, bin: string, lot: string, qty: number) {
  const r = rows.find((x) => x.item_no === item && x.bin === bin && x.lot === lot);
  if (r) r.qty = round(r.qty + qty);
  else rows.push({ item_no: item, bin, lot, qty });
}

export function postReceipt(s: Store, body: Record<string, unknown>, actor: string) {
  const poId = str(body.po_id);
  if (!poId) throw badRequest("po_id is required");
  if (!Array.isArray(body.lines) || body.lines.length === 0) throw badRequest("lines must be a non-empty array");
  const date = str(body.receipt_date) || todayIsoDate();
  if (!isDate(date)) throw badRequest("receipt_date must be YYYY-MM-DD");
  const lines: ReceiptLineIn[] = body.lines.map((raw: unknown, i: number) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (!str(r.line_id) || !str(r.item_no)) throw badRequest(`lines[${i}]: line_id and item_no are required`);
    if (typeof r.qty !== "number" || !Number.isFinite(r.qty)) throw badRequest(`lines[${i}]: qty must be a number`);
    return { line_id: str(r.line_id), item_no: str(r.item_no), qty: r.qty, lot_no: str(r.lot_no), bin_code: str(r.bin_code), close_line: r.close_line === true };
  });
  const poLines = master(s, "vendor_po_lines").filter((l) => l.po_number === poId);
  if (poLines.length === 0) throw notFound(`Purchase order ${poId} not found`);

  const operator = operatorOf(body.operator, actor);
  const states = getLineStates(s);
  const tol = getSettings(s).over_delivery_tolerance_pct;
  const bins = new Set(getBins(s).map((b) => b.code));
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const l of lines) {
    const pl = poLines.find((x) => lineKey(x) === l.line_id);
    if (seen.has(l.line_id)) errors.push(`${l.line_id}: line appears more than once`);
    seen.add(l.line_id);
    if (!pl) {
      errors.push(`${l.line_id}: not a line of ${poId}`);
      continue;
    }
    if (pl.component_item_no !== l.item_no) errors.push(`${l.line_id}: item ${l.item_no} does not match the PO line (${pl.component_item_no})`);
    if (pl.status !== "Open") {
      errors.push(`${l.item_no}: line ${l.line_id} is already fully received`);
      continue;
    }
    const st = stateOf(states, pl);
    const limit = st.ordered * (1 + tol / 100) - st.received;
    if (!(l.qty > 0)) errors.push(`${l.item_no}: quantity must be greater than 0`);
    else if (l.qty > limit + EPS) errors.push(`${l.item_no}: quantity ${l.qty} exceeds the allowed ${round(limit)} (tolerance ${tol}%)`);
    if (l.bin_code && !bins.has(l.bin_code)) errors.push(`${l.item_no}: unknown bin ${l.bin_code}`);
    if (LOT_TRACKED.has(l.item_no) && !l.lot_no) errors.push(`${l.item_no}: lot number required`);
  }

  const histLines: HistoryLine[] = lines.map((l) => ({ line_id: l.line_id, item_no: l.item_no, qty: l.qty, lot_no: l.lot_no, bin_code: l.bin_code || DEFAULT_BIN[l.item_no] || FALLBACK_BIN }));
  if (errors.length) {
    const e = journal(s, { type: "receipt", status: "rejected", operator, po_number: poId, receipt_date: date, errors, lines: histLines });
    audit(s, operator, "receipt.reject", `${poId}: ${errors.join("; ")}`);
    return { id: e.id, status: "rejected", po_id: poId, po_number: poId, receipt_date: date, operator, errors, lines: [] as unknown[] };
  }

  s.update<Record<string, LineState>>(KEYS.lines, () => ({}), (st) => {
    for (const l of lines) {
      const pl = poLines.find((x) => lineKey(x) === l.line_id)!;
      const cur = st[l.line_id] ?? { ordered: pl.quantity, received: 0 };
      const outstanding = cur.ordered - cur.received;
      cur.received = round(cur.received + l.qty);
      if (l.qty > outstanding + EPS) cur.ordered = cur.received;
      else if (l.close_line && l.qty < outstanding - EPS) cur.ordered = cur.received;
      st[l.line_id] = cur;
    }
  });
  const after = getLineStates(s);
  updateMaster(s, "vendor_po_lines", (all) => {
    for (const l of lines) {
      const ml = all.find((x) => lineKey(x) === l.line_id)!;
      const st = after[l.line_id];
      const out = st.ordered - st.received;
      if (out <= EPS) {
        ml.status = "Received";
        ml.quantity = st.received;
      } else ml.quantity = round(out);
    }
  });
  updateMaster(s, "components", (cs) => {
    for (const l of lines) {
      const c = cs.find((x) => x.item_no === l.item_no);
      if (c) c.on_hand = round(c.on_hand + l.qty);
    }
  });
  s.update<StockRow[]>(KEYS.stock, () => seedStock(s), (rows) => {
    for (const l of histLines) addStock(rows, l.item_no, l.bin_code, l.lot_no, l.qty);
  });
  const dates = s.get<Record<string, string>>(KEYS.poDates, () => ({}));
  const before = dates[poId] ?? poLines.map((l) => l.receipt_date).sort()[0];
  const changed = before !== date;
  if (changed) s.update<Record<string, string>>(KEYS.poDates, () => ({}), (d) => void (d[poId] = date));

  const e = journal(s, { type: "receipt", status: "posted", operator, po_number: poId, receipt_date: date, lines: histLines });
  audit(s, operator, "receipt.post", `${poId} dated ${date}: ${histLines.map((l) => `${l.item_no} x ${l.qty} -> ${l.bin_code}`).join("; ")}`);
  return {
    id: e.id,
    status: "posted",
    po_id: poId,
    po_number: poId,
    receipt_date: date,
    operator,
    lines: lines.map((l) => ({ line_id: l.line_id, item_no: l.item_no, qty: l.qty, result: "ok" })),
    posting_date_change: { changed, before, after: date },
  };
}

export function itemStock(s: Store, item: string) {
  if (!item.trim()) throw badRequest("item_no is required");
  const zone = new Map(getBins(s).map((b) => [b.code, b.zone]));
  return getStock(s)
    .filter((r) => r.item_no === item.trim() && r.qty > 0)
    .map((r) => ({ item_no: r.item_no, zone: zone.get(r.bin) ?? "", bin: r.bin, lot: r.lot, qty: r.qty }))
    .sort((a, b) => a.bin.localeCompare(b.bin) || a.lot.localeCompare(b.lot));
}

function available(rows: StockRow[], item: string, bin: string, lot: string): number {
  const here = rows.filter((r) => r.item_no === item && r.bin === bin && r.qty > 0);
  if (here.some((r) => r.lot)) {
    if (!lot) throw badRequest(`${item} is lot-tracked in ${bin}: lot_no is required`);
    return here.find((r) => r.lot === lot)?.qty ?? 0;
  }
  return here.reduce((t, r) => t + r.qty, 0);
}

function take(rows: StockRow[], item: string, bin: string, lot: string, qty: number) {
  let left = qty;
  for (const r of rows.filter((x) => x.item_no === item && x.bin === bin && (lot ? x.lot === lot : true) && x.qty > 0)) {
    const t = Math.min(r.qty, left);
    r.qty = round(r.qty - t);
    left = round(left - t);
    if (left <= EPS) break;
  }
}

export function postMovement(s: Store, body: Record<string, unknown>, actor: string) {
  const kind = body.kind;
  if (kind !== "move" && kind !== "adjust") throw badRequest('kind must be "move" or "adjust"');
  const item = str(body.item_no);
  if (!item) throw badRequest("item_no is required");
  if (!master(s, "components").some((c) => c.item_no === item)) throw notFound(`Unknown item ${item}`);
  const qty = body.qty;
  if (typeof qty !== "number" || !Number.isFinite(qty) || qty === 0) throw badRequest("qty must be a non-zero number");
  const lot = str(body.lot_no);
  const bins = new Set(getBins(s).map((b) => b.code));
  const operator = operatorOf(body.operator, actor);
  const rows = getStock(s);
  const base = { type: kind as "move" | "adjust", status: "posted" as const, operator, item_no: item, qty, lot_no: lot };

  if (kind === "move") {
    const from = str(body.from_bin);
    const to = str(body.to_bin);
    if (!from || !to) throw badRequest("from_bin and to_bin are required for a movement");
    if (!bins.has(from)) throw badRequest(`Unknown bin ${from}`);
    if (!bins.has(to)) throw badRequest(`Unknown bin ${to}`);
    if (from === to) throw badRequest("from_bin and to_bin must differ");
    if (qty < 0) throw badRequest("qty must be positive for a movement");
    const avail = available(rows, item, from, lot);
    if (qty > avail + EPS) throw badRequest(`Only ${avail} available in ${from}${lot ? ` under lot ${lot}` : ""}`);
    const moveLot = lot || rows.find((r) => r.item_no === item && r.bin === from && r.qty > 0)?.lot || "";
    s.update<StockRow[]>(KEYS.stock, () => seedStock(s), (d) => {
      take(d, item, from, lot, qty);
      addStock(d, item, to, moveLot, qty);
    });
    const e = journal(s, { ...base, lot_no: moveLot, from_bin: from, to_bin: to });
    audit(s, operator, "movement.move", `${item} x ${qty}: ${from} -> ${to}${moveLot ? ` (lot ${moveLot})` : ""}`);
    return e;
  }

  const bin = str(body.bin_code);
  if (!bin) throw badRequest("bin_code is required for an adjustment");
  if (!bins.has(bin)) throw badRequest(`Unknown bin ${bin}`);
  const reason = str(body.reason);
  if (qty < 0) {
    const avail = available(rows, item, bin, lot);
    if (-qty > avail + EPS) throw badRequest(`Only ${avail} available in ${bin}${lot ? ` under lot ${lot}` : ""}`);
  } else if (LOT_TRACKED.has(item) && !lot) throw badRequest(`${item} is lot-tracked: lot_no is required`);
  s.update<StockRow[]>(KEYS.stock, () => seedStock(s), (d) => {
    if (qty < 0) take(d, item, bin, lot, -qty);
    else addStock(d, item, bin, lot, qty);
  });
  updateMaster(s, "components", (cs) => {
    const c = cs.find((x) => x.item_no === item)!;
    c.on_hand = Math.max(0, round(c.on_hand + qty));
  });
  const e = journal(s, { ...base, bin_code: bin, reason });
  audit(s, operator, "movement.adjust", `${item} ${qty >= 0 ? "+" : ""}${qty} @ ${bin}${reason ? ` (${reason})` : ""}`);
  return e;
}

function allPos(s: Store) {
  const vendors = master(s, "vendors");
  const states = getLineStates(s);
  const vname = (id: string) => vendors.find((v) => v.id === id)?.name ?? id;
  const out = [...groupByPo(s).entries()].map(([po, ls]) => ({
    po_number: po,
    vendor_no: ls[0].vendor_id,
    vendor_name: vname(ls[0].vendor_id),
    complete: ls.every((l) => l.status === "Received"),
    fallbackDate: ls.map((l) => l.receipt_date).sort().at(-1) ?? "",
    lines: ls.map((l) => {
      const st = stateOf(states, l);
      return { item_no: l.component_item_no, description: describe(s, l.component_item_no), ordered: st.ordered, received: st.received };
    }),
  }));
  for (const lp of s.get<LegacyPo[]>(KEYS.legacy, seedLegacy)) {
    out.push({
      po_number: lp.po_number,
      vendor_no: lp.vendor_id,
      vendor_name: vname(lp.vendor_id),
      complete: true,
      fallbackDate: lp.last_receipt_date,
      lines: lp.lines.map((l) => ({ ...l, description: describe(s, l.item_no) })),
    });
  }
  return out;
}

export function completedPos(s: Store) {
  return allPos(s)
    .filter((p) => p.complete)
    .map((p) => {
      const rl = receivedJournal(s, p.po_number);
      const last = rl.map((r) => r.receipt_date).sort().at(-1) ?? p.fallbackDate;
      return { po_id: p.po_number, po_number: p.po_number, vendor_no: p.vendor_no, vendor_name: p.vendor_name, last_receipt_date: last, received_via_app: rl.length > 0, received_lines: rl };
    })
    .sort((a, b) => b.last_receipt_date.localeCompare(a.last_receipt_date) || a.po_number.localeCompare(b.po_number));
}

export function poReceivedLines(s: Store, poId: string) {
  if (!poId.trim()) throw badRequest("po_id is required");
  const p = allPos(s).find((x) => x.po_number === poId.trim());
  if (!p) throw notFound(`Purchase order ${poId} not found`);
  return p.lines;
}

export function putSettings(s: Store, body: Record<string, unknown>, actor: string): WhSettings {
  const v = body.values as Record<string, any> | undefined;
  if (!v || typeof v !== "object") throw badRequest("values is required");
  const cur = getSettings(s);
  const tol = v.over_delivery_tolerance_pct ?? cur.over_delivery_tolerance_pct;
  if (typeof tol !== "number" || !Number.isFinite(tol) || tol < 0 || tol > 100) throw badRequest("over_delivery_tolerance_pct must be between 0 and 100");
  const mode = v.scanner?.mode ?? cur.scanner.mode;
  if (!SCANNER_MODES.includes(mode)) throw badRequest(`scanner.mode must be one of ${SCANNER_MODES.join(", ")}`);
  const sym = v.barcode?.symbology ?? cur.barcode.symbology;
  if (!SYMBOLOGIES.includes(sym)) throw badRequest(`barcode.symbology must be one of ${SYMBOLOGIES.join(", ")}`);
  const label = v.printer?.label_printer ?? cur.printer.label_printer;
  const doc = v.printer?.document_printer ?? cur.printer.document_printer;
  if (typeof label !== "string" || typeof doc !== "string") throw badRequest("printer values must be strings");
  const next: WhSettings = { over_delivery_tolerance_pct: tol, printer: { label_printer: label.trim(), document_printer: doc.trim() }, scanner: { mode }, barcode: { symbology: sym } };
  s.set(KEYS.settings, next);
  const changes = (Object.keys(next) as (keyof WhSettings)[]).filter((k) => JSON.stringify(next[k]) !== JSON.stringify(cur[k]));
  audit(s, operatorOf(body.operator, actor), "settings.update", changes.length ? `changed: ${changes.join(", ")}` : "no change");
  return next;
}

export function listHistory(s: Store, kind: string) {
  if (kind && !["receipt", "move", "adjust"].includes(kind)) throw badRequest("kind must be receipt, move or adjust");
  return history(s).filter((h) => !kind || h.type === kind).reverse();
}
