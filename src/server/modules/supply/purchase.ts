import { appendAudit } from "../../audit";
import { badRequest } from "../../http";
import { master, updateMaster } from "../../master";
import type { Store } from "../../store";

export interface PushLine {
  item_no: string;
  quantity: number;
  required_date: string;
  unit_price?: number;
}

const isDate = (s: unknown): s is string => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  // An impossible date like 2026-13-40 gives an Invalid Date, whose toISOString() throws.
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

/**
 * Create a draft purchase order in the LOCAL simulated connector (no external system).
 * Draft lines are added to the master vendor PO lines and count as supply at once (P).
 */
export function pushPurchaseOrder(store: Store, actor: string, body: Record<string, unknown>) {
  const vendorNo = String(body.vendor_no ?? "").trim();
  const vendor = master(store, "vendors").find((v) => v.id === vendorNo);
  if (!vendor) throw badRequest(`Unknown vendor "${vendorNo}"`);
  const lines = Array.isArray(body.lines) ? (body.lines as PushLine[]) : [];
  if (lines.length === 0) throw badRequest("At least one line is required");
  const items = new Map(master(store, "components").map((c) => [c.item_no, c]));
  let amount = 0;
  for (const l of lines) {
    const it = items.get(String(l?.item_no));
    if (!it) throw badRequest(`Unknown item "${l?.item_no}"`);
    if (typeof l.quantity !== "number" || !(l.quantity > 0)) throw badRequest(`Quantity for ${l.item_no} must be greater than 0`);
    if (!isDate(l.required_date)) throw badRequest(`required_date for ${l.item_no} must be a valid YYYY-MM-DD date`);
    if (l.unit_price !== undefined && (typeof l.unit_price !== "number" || l.unit_price < 0)) {
      throw badRequest(`unit_price for ${l.item_no} must be 0 or more`);
    }
    amount += l.quantity * (l.unit_price ?? it.unit_cost);
  }
  const delivery = lines.map((l) => l.required_date).sort()[0];
  const poNumber = updateMaster(store, "vendor_po_lines", (all) => {
    const seq = Math.max(9000, ...all.map((p) => Number(/^V-PO-D(\d+)$/.exec(p.po_number)?.[1] ?? 0))) + 1;
    const no = `V-PO-D${seq}`;
    lines.forEach((l, i) =>
      all.push({
        po_number: no, line_no: String(i + 1), vendor_id: vendor.id, component_item_no: l.item_no,
        quantity: l.quantity, need_date: l.required_date, receipt_date: l.required_date, status: "Open",
      }),
    );
    return no;
  });
  amount = Math.round(amount * 100) / 100;
  appendAudit(store, {
    source: "supply", actor, action: "Draft purchase order created",
    detail: `${poNumber} · ${vendor.id} · ${lines.map((l) => `${l.item_no} x${l.quantity}`).join(", ")} · ${amount}`,
  });
  return { bc_po_number: poNumber, vendor_name: vendor.name, amount, delivery_date: delivery };
}
