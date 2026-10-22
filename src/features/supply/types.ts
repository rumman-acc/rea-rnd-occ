export type Health = "red" | "yellow" | "green";

export interface BomRow {
  item_no: string;
  description: string;
  level: number;
  is_subassembly: boolean;
  extended_qty: number;
}
export interface NettingOrder {
  so_number: string;
  kind: "sales" | "plan";
  item_no: string;
  description: string;
  customer_name: string | null;
  series: string | null;
  model: string | null;
  month: string | null;
  quantity: number;
  delivery_date: string | null;
  prod_order_no: string | null;
  bom: BomRow[];
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
export interface Netting {
  orders: NettingOrder[];
  projections_without: Record<string, Projection>;
  projections_with: Record<string, Projection>;
}
export interface FgEntry {
  item_no: string;
  description: string;
  series: string | null;
  model: string | null;
  demand_source: "orders" | "plan" | "both" | "none";
}
export interface SupplyComponent {
  item_no: string;
  description: string;
  level: number;
  is_subassembly: boolean;
  qty_per_unit: number;
  required: number;
  on_hand: number;
  reserved: number;
  on_po: number;
  po_eta: string | null;
  net_available: number;
  status: Health;
  vendor_no: string;
  vendor_name: string | null;
  lead_time_days: number | null;
  last_direct_cost: number | null;
  unit_cost: number;
  minimum_order_qty: number;
  order_multiple: number;
  reservations: { reserved_for: string; qty: number }[];
  open_pos: { po_number: string; vendor_no: string; qty: number; eta: string }[];
}
export interface VendorSummary {
  vendor_no: string;
  name: string;
  parts: string[];
  max_lead_time_days: number;
  reliability_pct: number | null;
  reliability_source: string;
  avg_overdue_days: number;
  prices: Record<string, number>;
  contact: string;
}
export interface SupplySalesOrder {
  so_number: string;
  customer_name: string | null;
  quantity: number;
  delivery_date: string;
  value: number;
  is_planned: boolean;
}
export interface SupplyDetail {
  fg_item_no: string;
  description: string;
  series: string | null;
  model: string | null;
  customers: string[];
  bc_demand: number;
  planned_demand: number;
  total_demand: number;
  overall: Health;
  nc_risk_pct: number;
  components: SupplyComponent[];
  vendor_summary: VendorSummary[];
  sales_orders: SupplySalesOrder[];
}
export interface BuyRecommendation {
  recommended_qty: number;
  eta: string;
  unit_cost?: number;
  rationale: string;
  horizon: string;
  expedite: boolean;
  lead_time_days: number;
  vendor_delay_days: number;
  effective_lead_days: number;
  reliability_pct?: number | null;
  order_by: string;
}
export interface PushResult {
  bc_po_number?: string;
  vendor_name?: string;
  amount?: number;
  delivery_date?: string;
}
export const HORIZONS = [
  { value: "auto", label: "Auto (recommended)" },
  { value: "urgent", label: "Urgent / immediate" },
  { value: "2w", label: "Within 2 weeks" },
  { value: "1m", label: "Within 1 month" },
  { value: "3m", label: "Within 3 months" },
] as const;
