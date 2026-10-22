// Field names mirror the original's observed client contract (SPEC DAT-001).
// Types are inferred from usage (DAT-002); the real response schema is unconfirmed (OQ-009).

export type Health = "green" | "yellow" | "red";

export interface Kpis {
  open_so_lines: number;
  open_units: number;
  open_value: number;
  on_time_pct: number;
  linked_pct: number;
  critical_items: number;
  expedite_lines: number;
  revenue_at_risk: number;
}

export interface StatusRow {
  so_number: string;
  item_no: string;
  customer_name: string | null;
  series: string | null;
  /** ISO date ("YYYY-MM-DD") or datetime string. */
  delivery_date: string | null;
  quantity: number;
  unit_price: number;
  health: Health;
}

export interface Plan {
  generated_at: string;
  kpis: Kpis;
  status_board: StatusRow[];
  /** Consumed only by other pages; opaque here. */
  capacity?: unknown[];
}

export interface VersionInfo {
  version: string;
}
