import type { Kpis, Plan, StatusRow } from "@/domain/types";

// Deterministic demo dataset (SPEC §3.4).
//
// Every value here is FIXTURE DATA. It is not evidence of the original's data
// or business rules, and no KPI is computed from rows (SPEC KPI-011).

/** FX-KPI: displayed values observed on the original dashboard (SPEC §3.4). */
export const FX_KPI: Readonly<Kpis> = Object.freeze({
  open_so_lines: 8,
  open_units: 45,
  open_value: 43975,
  on_time_pct: 50,
  linked_pct: 75,
  critical_items: 3,
  expedite_lines: 3,
  revenue_at_risk: 33858,
});

/**
 * FX-ROWS, in provider order. Rows 1–7: text observed; unit_price is the
 * displayed value divided by quantity (AS-02); the year 2026 is assumed (AS-01);
 * item_no is a placeholder. Row 8 is SYNTHETIC (AS-03): its existence is
 * inferred from the donut proportions and series totals, its other fields are
 * invented placeholders.
 */
export const FX_ROWS: readonly Readonly<StatusRow>[] = Object.freeze([
  { so_number: "S-ORD101001", item_no: "10", customer_name: "Northwind Water Utilities", series: "1000", delivery_date: "2026-10-22", quantity: 10, unit_price: 685, health: "red" },
  { so_number: "S-ORD101006", item_no: "20", customer_name: "Coastal Desalination Ltd", series: "2000", delivery_date: "2026-10-25", quantity: 12, unit_price: 540, health: "red" },
  { so_number: "S-ORD101005", item_no: "30", customer_name: "Meridian Oil & Gas", series: "1000", delivery_date: "2026-10-28", quantity: 8, unit_price: 685, health: "red" },
  { so_number: "S-ORD101007", item_no: "40", customer_name: "Lakeview Municipal Water", series: "3000", delivery_date: "2026-11-15", quantity: 1, unit_price: 3200, health: "red" },
  { so_number: "S-ORD101004", item_no: "50", customer_name: "Sterling Chemical Works", series: "6000", delivery_date: "2026-11-23", quantity: 1, unit_price: 8900, health: "red" },
  { so_number: "S-ORD101008", item_no: "60", customer_name: "Ridgeline Mining", series: "1000", delivery_date: "2026-10-26", quantity: 5, unit_price: 685, health: "yellow" },
  { so_number: "S-ORD101003", item_no: "70", customer_name: "Harbor Marine Supply", series: "3000", delivery_date: "2026-11-20", quantity: 2, unit_price: 3200, health: "yellow" },
  // Synthetic placeholder row (never shown in the table: health is green).
  { so_number: "S-ORD101002", item_no: "80", customer_name: "Placeholder Customer", series: "2000", delivery_date: "2026-11-30", quantity: 6, unit_price: 540, health: "green" },
] satisfies StatusRow[]);

/** FX-META (SPEC §3.4). */
export const FX_GENERATED_AT = "2026-10-19T19:11:44";
export const FX_VERSION = "1.47.0";

export const FX_PLAN: Readonly<Plan> = Object.freeze({
  generated_at: FX_GENERATED_AT,
  kpis: FX_KPI,
  status_board: FX_ROWS as StatusRow[],
  capacity: [],
});
