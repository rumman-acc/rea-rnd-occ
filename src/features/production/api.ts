import { del, get, post, put, qs } from "@/lib/api/request";

export type Health = "green" | "yellow" | "red";

export interface OrderRow {
  po_number: string;
  so_number: string | null;
  customer_name: string;
  item_no: string;
  series: string;
  model: string;
  start_date: string;
  end_date: string;
  quantity: number;
  pct_complete: number;
  delivery_date: string | null;
  health: Health | null;
  linked: boolean;
}

export interface LinkageRow {
  so_number: string;
  item_no: string;
  customer_name: string | null;
  series: string | null;
  model: string;
  delivery_date: string | null;
  quantity: number;
  unit_price: number;
  health: Health;
  prod_order_no: string | null;
  prod_start: string | null;
  prod_end: string | null;
  prod_pct_complete: number | null;
  buffer_days: number | null;
}

export interface SimInput {
  overrides: Array<{ po_number: string; [k: string]: unknown }>;
  new_orders: Array<{ name: string; [k: string]: unknown }>;
}

export interface ScheduleOrder {
  po_number: string;
  so_number: string | null;
  fg_item_no: string;
  model: string;
  quantity: number;
  start_date: string;
  end_date: string;
  status: "Planned" | "Released" | "Finished";
  pct_complete: number;
  customer_name: string | null;
  delivery_date: string | null;
  buffer_days: number | null;
  health: Health | null;
  simulated: boolean;
  changed: boolean;
}

export interface Schedule {
  today: string;
  orders: ScheduleOrder[];
  lines: LinkageRow[];
  fg_items: Array<{ item_no: string; description: string }>;
  unlinked_sos: string[];
}

export interface WorkCenter {
  code: string;
  name: string;
  headcount: number;
  hours_per_shift: number;
  labor_rate: number;
}

type LinkageResult = { rows: LinkageRow[]; warnings: Array<{ code: string }> };

export const getOrders = () => get<OrderRow[]>("/api/production/orders");
export const getLinkage = (sim?: SimInput) => (sim ? post<LinkageResult>("/api/production/linkage", sim) : get<LinkageResult>("/api/production/linkage"));
export const getSchedule = (sim?: SimInput) => (sim ? post<Schedule>("/api/production/schedule", sim) : get<Schedule>("/api/production/schedule"));
export const orderAction = (po: string, action: "release" | "finish") => post<unknown>(`/api/production/orders/${encodeURIComponent(po)}/${action}`);
export const rescheduleOrder = (po: string, start_date: string, end_date: string) =>
  post<unknown>(`/api/production/orders/${encodeURIComponent(po)}/reschedule`, { start_date, end_date });
export const createOrder = (o: { fg_item_no: string; quantity: number; so_number?: string; start_date: string; end_date: string }) =>
  post<unknown>("/api/production/orders", o);
export const getWorkCenters = () => get<WorkCenter[]>("/api/workcenters");

// capacity / costing share this client
export interface Period { key: string; label: string; start: string; end: string }
export interface CapacityCell { period: string; available_hours: number; demand_hours: number; utilization_pct: number | null; status: "ok" | "tight" | "over" }
export interface Adjustment { id: number; work_center: string; start_date: string; end_date: string; hours_per_day: number; reason: string }
export interface CapacityPlan {
  granularity: "week" | "month";
  today: string;
  periods: Period[];
  work_centers: Array<{ code: string; name: string; headcount: number; rows: CapacityCell[] }>;
  adjustments: Adjustment[];
  summary: { overloaded: number; peak_utilization_pct: number };
}
export interface CapacityDemand {
  granularity: string;
  periods: Period[];
  orders: Array<{ po_number: string; item_no: string; status: string; remaining_units: number; hours: Record<string, number>; total_hours: number }>;
}
export interface ScenarioInput {
  granularity: "week" | "month";
  headcounts: Record<string, number>;
  po_shifts: Record<string, number>;
  po_quantities: Record<string, number>;
  new_orders: Array<{ name: string; fg_item_no: string; quantity: number; start_date: string; end_date: string }>;
  po_dates: Record<string, { start_date?: string; end_date?: string }>;
}
export interface ScenarioResult {
  granularity: string;
  periods: Period[];
  baseline: CapacityPlan;
  scenario: CapacityPlan;
  delta: { overloaded_before: number; overloaded_after: number; peak_before: number; peak_after: number };
}
export interface RoutingView {
  models: Record<string, Record<string, number>>;
  work_centers: string[];
  items: Array<{ item_no: string; description: string }>;
}

export const getCapacityPlan = (g: string) => get<CapacityPlan>(`/api/capacity/plan${qs({ granularity: g })}`);
export const getCapacityDemand = (g: string) => get<CapacityDemand>(`/api/capacity/demand${qs({ granularity: g })}`);
export const runScenario = (s: ScenarioInput) => post<ScenarioResult>("/api/capacity/scenario", s);
export const putHeadcounts = (headcounts: Record<string, number>) => put<WorkCenter[]>("/api/capacity/headcounts", { headcounts });
export const getRouting = () => get<RoutingView>("/api/capacity/routing-times");
export const putRouting = (models: Record<string, Record<string, number>>) => put<RoutingView>("/api/capacity/routing-times", { models });
export const addAdjustment = (a: Omit<Adjustment, "id">) => post<Adjustment>("/api/capacity/adjustments", a);
export const deleteAdjustment = (id: number) => del<{ ok: boolean }>(`/api/capacity/adjustments/${id}`);
export const putLaborRates = (rates: Record<string, number>, overhead_pct: number) => put<unknown>("/api/capacity/labor-rates", { rates, overhead_pct });

export interface CostItem {
  item_no: string;
  description: string;
  series: string;
  material_cost: number;
  labor_cost: number;
  overhead_cost: number;
  total_cost: number;
  sales_price: number | null;
  margin: number | null;
  margin_pct: number | null;
  components: Array<{ item_no: string; description: string; qty_per: number; unit_cost: number; extended: number }>;
  operations: Array<{ work_center: string; name: string; hours: number; rate: number; extended: number }>;
}
export const getCosting = () => get<{ overhead_pct: number; items: CostItem[] }>("/api/production/costing");
