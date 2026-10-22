import type { Store } from "../../store";

// Supply-module extras under the "supply:" key prefix (SPEC supply.md REQ-SUP-DAT-001).
// Everything here is our own demo data (P).

export interface Reservation {
  reserved_for: string;
  qty: number;
}
export interface ComponentParams {
  minimum_order_qty: number;
  order_multiple: number;
  lead_time_days?: number;
}
export interface SubAssembly {
  fg_item_no: string;
  item_no: string;
  description: string;
  qty_per: number;
  /** Components (from the master BOM) nested under this sub-assembly. */
  components: string[];
}
export interface PlannedDemand {
  so_number: string;
  item_no: string;
  month: string;
  quantity: number;
}
export interface ReceiptRecord {
  vendor_id: string;
  po_number: string;
  need_date: string;
  received_date: string;
}
export interface SupplyData {
  nc_risk_pct: number;
  models: Record<string, string>;
  reservations: Record<string, Reservation[]>;
  params: Record<string, ComponentParams>;
  subassemblies: SubAssembly[];
  planned_demand: PlannedDemand[];
  receipt_history: ReceiptRecord[];
  contacts: Record<string, string>;
}

export function seedSupply(): SupplyData {
  return {
    nc_risk_pct: 0,
    models: { "FG-1000": "M-100", "FG-2000": "M-200", "FG-3000": "M-300", "FG-6000": "M-600" },
    reservations: {
      "CMP-A": [{ reserved_for: "P-ORD201001 (released)", qty: 4 }],
      "CMP-B": [{ reserved_for: "P-ORD201002 (released)", qty: 10 }],
      "CMP-C": [{ reserved_for: "P-ORD201004 (released)", qty: 2 }],
      "CMP-D": [{ reserved_for: "P-ORD201006 (planned)", qty: 20 }],
    },
    params: {
      "CMP-A": { minimum_order_qty: 10, order_multiple: 5 },
      "CMP-B": { minimum_order_qty: 1, order_multiple: 1 },
      "CMP-C": { minimum_order_qty: 1, order_multiple: 1 },
      "CMP-D": { minimum_order_qty: 1, order_multiple: 1 },
      "CMP-E": { minimum_order_qty: 5, order_multiple: 1, lead_time_days: 28 },
      "CMP-F": { minimum_order_qty: 1, order_multiple: 1 },
    },
    subassemblies: [
      { fg_item_no: "FG-6000", item_no: "SUB-6100", description: "Mounting sub-assembly", qty_per: 1, components: ["CMP-F"] },
    ],
    planned_demand: [{ so_number: "PLAN-FG-6000-2026-12", item_no: "FG-6000", month: "2026-12", quantity: 1 }],
    receipt_history: [
      { vendor_id: "V-100", po_number: "V-PO-4001", need_date: "2026-03-10", received_date: "2026-03-10" },
      { vendor_id: "V-100", po_number: "V-PO-4002", need_date: "2026-05-02", received_date: "2026-05-08" },
      { vendor_id: "V-100", po_number: "V-PO-4003", need_date: "2026-07-15", received_date: "2026-07-14" },
      { vendor_id: "V-100", po_number: "V-PO-4004", need_date: "2026-09-01", received_date: "2026-09-04" },
      { vendor_id: "V-200", po_number: "V-PO-4101", need_date: "2026-04-12", received_date: "2026-04-11" },
      { vendor_id: "V-200", po_number: "V-PO-4102", need_date: "2026-08-20", received_date: "2026-08-20" },
      { vendor_id: "V-200", po_number: "V-PO-4103", need_date: "2025-06-01", received_date: "2025-06-20" },
    ],
    contacts: {
      "V-100": "orders@apex.example",
      "V-200": "sales@brightline.example",
      "V-300": "desk@cobalt.example",
    },
  };
}

export function supplyData(store: Store): SupplyData {
  return store.get("supply:data", seedSupply);
}
