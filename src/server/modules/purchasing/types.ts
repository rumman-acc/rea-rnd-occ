// Purchasing module types (M-PUR). The original's response schemas are unknown; field names
// follow what the /purchasing page chunk reads, values and rules are our own design (P).

export const HORIZONS = ["auto", "urgent", "2w", "1m", "3m"] as const;
export type Horizon = (typeof HORIZONS)[number];
export const POSTURES = ["lean", "balanced", "covered"] as const;
export type Posture = (typeof POSTURES)[number];

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
  eta: string;
}

export interface DemandDetail {
  fg_item_no: string;
  fg_description: string;
  series: string | null;
  required: number;
  sales_orders: { so_number: string; customer_name: string | null; quantity: number; delivery_date: string; is_planned: boolean }[];
}

export interface Suggested {
  qty: number;
  price: number;
  delivery_date: string;
  preselect: boolean;
  expedite: boolean;
  flag_soon: boolean;
  notes: string[];
}

export interface RecommendationLine {
  supply_status: "red" | "yellow";
  item_no: string;
  description: string;
  vendor_no: string;
  vendor_name: string;
  vendor_reliability: number | null;
  series: string[];
  suggested: Suggested;
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

export interface PostLineIn {
  item_no: string;
  vendor_no: string;
  vendor_name?: string;
  qty: number;
  price: number | null;
  delivery_date: string;
}

export interface PoLineRec {
  item_no: string;
  qty: number;
  price: number;
}

/** Header of a PO created from the app (the lines themselves are master vendor_po_lines). */
export interface AppPo {
  po_number: string;
  vendor_id: string;
  created_at: string;
  operator: string;
  amount: number;
  lines: PoLineRec[];
}

export interface PoHistoryEntry {
  id: number;
  ts: string;
  operator: string;
  po_number: string | null;
  vendor_no: string;
  vendor_name: string;
  amount: number | null;
  lines: PoLineRec[];
  status: "created" | "failed";
  error?: string;
}
