import { todayIsoDate } from "@/server/clock";
import { componentBalances, master } from "@/server/master";
import type { Store } from "@/server/store";
import { MARKET_FACTOR, addDays, daysBetween, getConfig, round2 } from "./core";
import type { Proposal } from "./types";

// Deterministic, rule-based "agents" (spec REQ-AI-AGT-*). No model, no randomness, no external calls.

const MOQ = 10; // assumed: master data carries no minimum order quantity
const MAX_COMPRESSION = 0.4; // assumed maximum production-time compression
const PRODUCTION_DAYS = 14; // assumed standard production time for CTP

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function buyerProposals(store: Store): Proposal[] {
  const { persona, settings } = getConfig(store);
  const today = todayIsoDate();
  const comps = master(store, "components");
  const vendors = master(store, "vendors");
  const lines = master(store, "sales_lines");
  const bom = master(store, "bom");
  const poLines = master(store, "vendor_po_lines");
  const out: Proposal[] = [];
  for (const b of componentBalances(store).filter((x) => x.short)) {
    const comp = comps.find((c) => c.item_no === b.item_no);
    if (!comp) continue;
    const vendor = vendors.find((v) => v.id === comp.vendor_id);
    const lead = vendor?.lead_time_days ?? 14;
    const netNeed = -b.balance;
    const inflation = round2((MARKET_FACTOR[settings.supply_market_risk_factor] ?? 1) * (1 + (1 - persona.risk_tolerance) * 0.2));
    const qty = Math.ceil((netNeed * inflation) / MOQ) * MOQ;
    const users = bom.filter((x) => x.component_item_no === b.item_no).map((x) => x.fg_item_no);
    const stockout = lines.filter((l) => users.includes(l.fg_item_no)).map((l) => l.delivery_date).sort()[0] ?? addDays(today, lead);
    const receipt = addDays(today, lead);
    const expedite = addDays(receipt, settings.fulfillment_contingency_buffer_days) > stockout;
    const vl = poLines.filter((p) => p.vendor_id === comp.vendor_id);
    const onTime = vl.length ? Math.round((vl.filter((p) => p.receipt_date <= p.need_date).length / vl.length) * 100) : null;
    const conf = clamp(0.92 - (expedite ? 0.1 : 0) - (onTime !== null && onTime < 70 ? 0.12 : 0) - (onTime === null ? 0.08 : 0), 0.5, 0.97);
    const value = round2(qty * comp.unit_cost);
    out.push({
      action_type: "CREATE_PO",
      title: `Create PO — ${comp.item_no}`,
      recommended_action: `Order ${qty} × ${comp.item_no} (${comp.description}) from ${vendor?.name ?? comp.vendor_id}, delivery ${receipt}.`,
      ai_confidence_score: round2(conf),
      context_data: {
        why: `${comp.item_no} is projected ${netNeed} short (on hand ${b.on_hand}, incoming ${b.incoming}, required ${b.required}). Rule-based proposal, not a model output.`,
        expedite,
        simulation: { first_stockout: stockout, projected_trough: b.balance, vendor_on_time_pct: onTime },
        risk_sizing: { net_need: netNeed, inflation_factor: inflation, final_qty: qty },
        payload: { vendor_id: comp.vendor_id, item_no: comp.item_no, quantity: qty, need_date: stockout, receipt_date: receipt, unit_price: comp.unit_cost },
        item_no: comp.item_no,
        vendor_id: comp.vendor_id,
      },
      metrics: { po_value: value, quantity: qty, days_late: 0, net_need: netNeed },
    });
  }
  return out;
}

export function productionProposals(store: Store): Proposal[] {
  const { settings } = getConfig(store);
  const today = todayIsoDate();
  const buffer = settings.fulfillment_contingency_buffer_days;
  const lines = master(store, "sales_lines");
  const out: Proposal[] = [];
  for (const po of master(store, "production_orders")) {
    if (po.status === "Finished" || !po.so_number) continue;
    const line = lines.find((l) => l.so_number === po.so_number);
    if (!line || po.end_date <= line.delivery_date) continue;
    const duration = daysBetween(po.start_date, po.end_date);
    const target = addDays(line.delivery_date, -buffer);
    const ideal = addDays(target, -duration);
    const start = po.start_date <= today ? po.start_date : ideal > today ? ideal : today;
    const minEnd = addDays(start, Math.ceil(duration * (1 - MAX_COMPRESSION)));
    const end = target > minEnd ? target : minEnd;
    const ok = end <= line.delivery_date;
    const late = daysBetween(line.delivery_date, po.end_date);
    out.push({
      action_type: "RESCHEDULE_PROD_ORDER",
      title: `Reschedule ${po.po_number}`,
      recommended_action: `Move ${po.po_number} to ${start} → ${end} to ${ok ? "meet" : "get closer to"} the ${line.delivery_date} promise for ${po.so_number}.`,
      ai_confidence_score: ok ? 0.85 : 0.5,
      context_data: {
        why: `${po.po_number} ends ${late} day(s) after the promise date of ${po.so_number}. Assumes up to ${MAX_COMPRESSION * 100}% compression; capacity is not modelled.`,
        simulation: {
          before: { start: po.start_date, end: po.end_date, buffer_days: -late, health: "red", capacity_overloaded_days: 0 },
          after: { start, end, buffer_days: daysBetween(end, line.delivery_date), health: ok ? "green" : "red", capacity_overloaded_days: 0 },
        },
        payload: { po_number: po.po_number, new_start: start, new_end: end },
        po_number: po.po_number,
      },
      metrics: { po_value: 0, quantity: po.quantity, days_late: late, net_need: 0 },
    });
  }
  return out;
}

export interface OverdueLine {
  po_number: string;
  line_no: string;
  item_no: string;
  days_late: number;
}
export function overdueByVendor(store: Store): Map<string, OverdueLine[]> {
  const m = new Map<string, OverdueLine[]>();
  for (const l of master(store, "vendor_po_lines")) {
    if (l.status !== "Open" || l.receipt_date <= l.need_date) continue;
    const arr = m.get(l.vendor_id) ?? [];
    arr.push({ po_number: l.po_number, line_no: l.line_no, item_no: l.component_item_no, days_late: daysBetween(l.need_date, l.receipt_date) });
    m.set(l.vendor_id, arr);
  }
  return m;
}

export function supplierProposals(store: Store): Proposal[] {
  const { persona } = getConfig(store);
  const vendors = master(store, "vendors");
  const out: Proposal[] = [];
  for (const [vid, lines] of overdueByVendor(store)) {
    const v = vendors.find((x) => x.id === vid);
    const list = lines.map((l) => `${l.po_number}/${l.item_no} (${l.days_late}d)`).join(", ");
    const name = v?.name ?? vid;
    const body =
      persona.communication_style === "Direct/Brief"
        ? `Hello ${name},\n\nThese lines are late: ${list}.\nPlease confirm new dates today.\n`
        : persona.communication_style === "Data-Heavy"
          ? `Hello ${name},\n\nOverdue lines (PO/item, days late):\n${lines.map((l) => `- ${l.po_number} line ${l.line_no}, ${l.item_no}: ${l.days_late} days`).join("\n")}\n\nPlease reply with confirmed ship dates and quantities.\n`
          : `Hello ${name},\n\nThank you for your continued support. We noticed some lines are behind schedule: ${list}.\nCould you let us know when we can expect them?\n`;
    out.push({
      action_type: "EMAIL_SUPPLIER",
      title: `Expedite request — ${name}`,
      recommended_action: `Email ${name} about ${lines.length} overdue PO line(s): ${list}. The draft is not sent by this app.`,
      ai_confidence_score: round2(Math.min(0.95, 0.8 + 0.02 * lines.length)),
      context_data: {
        why: "Open vendor PO lines whose promised receipt is after the need date.",
        overdue_lines: lines,
        email: { to_vendor_name: name, subject: `Expedite request: ${lines.length} overdue PO line(s)`, body },
        vendor_id: vid,
      },
      metrics: { po_value: 0, quantity: lines.length, days_late: Math.max(...lines.map((l) => l.days_late)), net_need: 0 },
    });
  }
  return out;
}

export function ctpProposals(store: Store): Proposal[] {
  const { settings } = getConfig(store);
  const today = todayIsoDate();
  const bom = master(store, "bom");
  const comps = master(store, "components");
  const vendors = master(store, "vendors");
  const pos = master(store, "production_orders");
  const out: Proposal[] = [];
  for (const l of master(store, "sales_lines")) {
    if (pos.some((p) => p.so_number === l.so_number)) continue;
    const lead = Math.max(
      0,
      ...bom.filter((b) => b.fg_item_no === l.fg_item_no).map((b) => vendors.find((v) => v.id === comps.find((c) => c.item_no === b.component_item_no)?.vendor_id)?.lead_time_days ?? 0),
    );
    const date = addDays(today, lead + PRODUCTION_DAYS + settings.fulfillment_contingency_buffer_days);
    if (date <= l.delivery_date) continue;
    out.push({
      action_type: "CHANGE_SO_DATE",
      title: `Promise date — ${l.so_number}/${l.line_no}`,
      recommended_action: `Move the promise date of ${l.so_number} line ${l.line_no} from ${l.delivery_date} to ${date}.`,
      ai_confidence_score: 0.7,
      context_data: {
        why: `No production order is linked. Earliest date = today + longest component lead (${lead}d) + ${PRODUCTION_DAYS}d production + ${settings.fulfillment_contingency_buffer_days}d buffer.`,
        payload: { so_number: l.so_number, line_no: l.line_no, current_delivery_date: l.delivery_date, new_delivery_date: date },
        so_number: l.so_number,
      },
      metrics: { po_value: 0, quantity: l.quantity, days_late: daysBetween(l.delivery_date, date), net_need: 0 },
    });
  }
  return out;
}

export const AGENT_PROCEDURES: Record<string, (s: Store) => Proposal[]> = {
  replenishment: buyerProposals,
  production_sim: productionProposals,
  supplier_comms: supplierProposals,
  ctp_negotiator: ctpProposals,
};

/** Which analysis and action fit each flow trigger source (REQ-AI-FLOW-RULE-003). */
export const ENGINE: Record<string, { method: string; action: string; run: (s: Store) => Proposal[] }> = {
  component_shortages: { method: "buy_recommendation", action: "create_po", run: buyerProposals },
  late_production_orders: { method: "reschedule_simulation", action: "reschedule_prod_order", run: productionProposals },
  overdue_vendor_pos: { method: "supplier_chase_email", action: "email_supplier", run: supplierProposals },
  unlinked_sales_lines: { method: "ctp_estimate", action: "change_so_date", run: ctpProposals },
};
