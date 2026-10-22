import type { Health, Kpis, Plan, StatusRow } from "@/domain/types";
import { nowIso } from "./clock";
import { componentBalances, master } from "./master";
import type { Store } from "./store";

/**
 * Plan computation (SPEC-FULL §3.2, decision D6).
 *
 * IMPORTANT: every rule in this file is OUR OWN DESIGN. The original's KPI definitions,
 * health assignment and revenue-at-risk weighting are unknown (SPEC OQ-003, OQ-009).
 * The seed data was chosen so these rules reproduce the dashboard's demo figures.
 */

/** Weight applied to yellow ("Watch") value in revenue at risk. A design choice that reproduces the demo figure. */
export const YELLOW_AT_RISK_WEIGHT = 0.3;

const SEVERITY: Record<Health, number> = { red: 0, yellow: 1, green: 2 };

export interface PlanLine extends StatusRow {
  /** Production order linked to this line, if any. */
  linked_po: string | null;
  /** Linked production order ends on or before the delivery date. */
  on_time: boolean;
  /** True when a component of the item has a projected shortage. */
  material_short: boolean;
}

/**
 * Health rule:
 *  red    — no linked production order, or the linked order ends after the delivery date;
 *  yellow — linked and on time, but a component of the item has a projected shortage;
 *  green  — linked, on time, and no component shortage.
 */
export function planLines(store: Store): PlanLine[] {
  const lines = master(store, "sales_lines");
  const customers = master(store, "customers");
  const items = master(store, "fg_items");
  const pos = master(store, "production_orders");
  const bom = master(store, "bom");
  const short = new Set(componentBalances(store).filter((b) => b.short).map((b) => b.item_no));

  const rows = lines.map<PlanLine>((l) => {
    const po = pos.find((p) => p.so_number === l.so_number) ?? null;
    const onTime = po ? po.end_date <= l.delivery_date : false;
    const materialShort = bom.some((b) => b.fg_item_no === l.fg_item_no && short.has(b.component_item_no));
    const health: Health = !po || !onTime ? "red" : materialShort ? "yellow" : "green";
    return {
      so_number: l.so_number,
      item_no: l.line_no,
      customer_name: customers.find((c) => c.id === l.customer_id)?.name ?? null,
      series: items.find((i) => i.item_no === l.fg_item_no)?.series ?? null,
      delivery_date: l.delivery_date,
      quantity: l.quantity,
      unit_price: l.unit_price,
      health,
      linked_po: po?.po_number ?? null,
      on_time: onTime,
      material_short: materialShort,
    };
  });
  // Worst first; stable within the same health, so seed order is kept.
  return rows.map((r, i) => ({ r, i })).sort((a, b) => SEVERITY[a.r.health] - SEVERITY[b.r.health] || a.i - b.i).map((x) => x.r);
}

export function computeKpis(store: Store, rows: PlanLine[] = planLines(store)): Kpis {
  const value = (r: StatusRow) => r.quantity * r.unit_price;
  const linked = rows.filter((r) => r.linked_po);
  const onTime = linked.filter((r) => r.on_time);
  const red = rows.filter((r) => r.health === "red").reduce((s, r) => s + value(r), 0);
  const yellow = rows.filter((r) => r.health === "yellow").reduce((s, r) => s + value(r), 0);
  const lateLines = master(store, "vendor_po_lines").filter((l) => l.status === "Open" && l.receipt_date > l.need_date);
  return {
    open_so_lines: rows.length,
    open_units: rows.reduce((s, r) => s + r.quantity, 0),
    open_value: rows.reduce((s, r) => s + value(r), 0),
    on_time_pct: linked.length ? Math.round((onTime.length / linked.length) * 100) : 0,
    linked_pct: rows.length ? Math.round((linked.length / rows.length) * 100) : 0,
    critical_items: componentBalances(store).filter((b) => b.short).length,
    expedite_lines: lateLines.length,
    revenue_at_risk: red + YELLOW_AT_RISK_WEIGHT * yellow,
  };
}

/** The plan served at GET /api/plan. Extra per-line fields are stripped to the observed contract. */
export function computePlan(store: Store): Plan {
  const lines = planLines(store);
  return {
    generated_at: nowIso().slice(0, 19),
    kpis: computeKpis(store, lines),
    status_board: lines.map(({ linked_po: _l, on_time: _o, material_short: _m, ...row }) => row),
    capacity: [],
  };
}
