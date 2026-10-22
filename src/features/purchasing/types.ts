export type Horizon = "auto" | "urgent" | "2w" | "1m" | "3m";
export type Posture = "lean" | "balanced" | "covered";

export interface Persona {
  name: string;
  risk_posture: Posture;
  delivery_padding_days: number;
  horizon: Horizon;
  respect_moq: boolean;
}

export interface OpenPoRef {
  po_number: string;
  vendor_no: string;
  qty: number;
  eta: string | null;
}

export interface DemandDetail {
  fg_item_no: string;
  fg_description: string;
  series: string | null;
  required: number;
  sales_orders: { so_number: string; customer_name: string | null; quantity: number; delivery_date: string; is_planned: boolean }[];
}

export interface RecLine {
  supply_status: "red" | "yellow";
  item_no: string;
  description: string;
  vendor_no: string;
  vendor_name: string;
  vendor_reliability: number | null;
  series: string[];
  suggested: { qty: number; price: number; delivery_date: string; preselect: boolean; expedite: boolean; flag_soon: boolean; notes: string[] };
  engine_qty: number;
  net_shortfall: number;
  order_by: string;
  delivery_date: string;
  open_pos: OpenPoRef[];
  demand_detail: DemandDetail[];
  total_required: number;
  on_hand: number;
  reserved: number;
  lead_time_days: number;
  reorder_quantity: number;
  moq: number;
  order_multiple: number;
  last_direct_cost: number;
  unit_cost: number;
  monthly_usage: number;
  rationale: string;
}

export interface Recommendations {
  persona: Persona;
  generated_at: string;
  engine: string;
  lines: RecLine[];
}

export interface PostLine {
  item_no: string;
  vendor_no: string;
  vendor_name: string;
  qty: number;
  price: number | null;
  delivery_date: string;
}

export interface PoLine {
  item_no: string;
  qty: number;
  price: number;
}

export interface PostResult {
  id: number;
  status: "created" | "failed";
  po_number: string | null;
  vendor_no: string;
  vendor_name: string;
  amount: number | null;
  delivery_date: string | null;
  lines: PoLine[];
  error?: string;
}

export interface OpenPo {
  po_number: string;
  vendor_no: string;
  vendor_name: string;
  order_date: string;
  status: string;
  amount: number;
  qty_ordered: number;
  qty_received: number;
  lines: number;
  items: string;
}

export interface PoHistoryRow {
  id: number;
  ts: string;
  operator: string;
  po_number: string | null;
  vendor_no: string;
  vendor_name: string;
  amount: number | null;
  lines: PoLine[];
  status: "created" | "failed";
  error?: string;
}

export interface PurchaseEntry {
  po_number: string;
  vendor_no: string;
  vendor_name: string;
  item_no: string;
  description: string;
  series: string;
  model: string;
  expected_date: string | null;
  first_invoice_date: string | null;
  last_invoice_date: string | null;
  qty_ordered: number;
  qty_received: number;
  amount_ordered: number;
  amount_received: number;
  status: string;
}

export interface ProjEvent {
  on_date: string;
  kind: "demand" | "po" | "recommended_po";
  delta: number;
  balance_after: number;
  reference: string;
}
export interface Projection {
  item_no: string;
  description: string;
  opening_inventory: number;
  min_balance: number;
  first_stockout_date: string | null;
  events: ProjEvent[];
}

export const HORIZON_OPTIONS: [Horizon, string][] = [
  ["auto", "Auto — tightest window with a shortfall"],
  ["urgent", "Urgent — inside replenishment lead"],
  ["2w", "2 weeks"],
  ["1m", "1 month"],
  ["3m", "3 months"],
];
export const POSTURE_OPTIONS: [Posture, string][] = [
  ["lean", "Lean — exact shortfall (JIT, min cash)"],
  ["balanced", "Balanced — engine recommendation"],
  ["covered", "Covered — plus half safety stock"],
];
