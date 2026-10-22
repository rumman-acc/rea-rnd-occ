// Master data shared by every module (SPEC-FULL §3). Field names are our own design;
// the original backend's schema is unknown (SPEC OQ-009).

export interface Customer {
  id: string;
  name: string;
}

export interface Vendor {
  id: string;
  name: string;
  lead_time_days: number;
}

/** Finished good, sold in a "series" (1000, 2000, 3000, 6000). */
export interface FgItem {
  item_no: string;
  description: string;
  series: string;
}

export interface SalesLine {
  so_number: string;
  /** Line number within the order, e.g. "10". Shown to the dashboard as `item_no`. */
  line_no: string;
  customer_id: string;
  fg_item_no: string;
  quantity: number;
  unit_price: number;
  order_date: string;
  /** Requested delivery date (YYYY-MM-DD). */
  delivery_date: string;
}

export type ProductionStatus = "Planned" | "Released" | "Finished";

export interface ProductionOrder {
  po_number: string;
  /** Sales order this production order covers; null when it is not linked. */
  so_number: string | null;
  fg_item_no: string;
  quantity: number;
  start_date: string;
  end_date: string;
  status: ProductionStatus;
}

export interface Component {
  item_no: string;
  description: string;
  uom: string;
  vendor_id: string;
  unit_cost: number;
  on_hand: number;
}

export interface BomLine {
  fg_item_no: string;
  component_item_no: string;
  qty_per: number;
}

export interface VendorPoLine {
  po_number: string;
  line_no: string;
  vendor_id: string;
  component_item_no: string;
  quantity: number;
  /** Date the component is needed by. */
  need_date: string;
  /** Promised receipt date. */
  receipt_date: string;
  status: "Open" | "Received";
}

export interface MasterData {
  customers: Customer[];
  vendors: Vendor[];
  fg_items: FgItem[];
  sales_lines: SalesLine[];
  production_orders: ProductionOrder[];
  components: Component[];
  bom: BomLine[];
  vendor_po_lines: VendorPoLine[];
}
