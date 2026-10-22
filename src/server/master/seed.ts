import type { MasterData } from "./types";

/**
 * Seed master data. The numbers are chosen so that the plan computed from them
 * (src/server/plan.ts) reproduces the dashboard figures observed on the original
 * demo (SPEC §3.4). That agreement is a property of this seed and of OUR documented
 * rules; it is not evidence of the original's rules.
 *
 * Shape of the demo: 8 open sales lines, 6 of them linked to a production order,
 * 3 of those ending on time; 3 components short of supply; 3 vendor PO lines late.
 */
export function seedMaster(): MasterData {
  return {
    customers: [
      { id: "C-01", name: "Northwind Water Utilities" },
      { id: "C-02", name: "Coastal Desalination Ltd" },
      { id: "C-03", name: "Meridian Oil & Gas" },
      { id: "C-04", name: "Lakeview Municipal Water" },
      { id: "C-05", name: "Sterling Chemical Works" },
      { id: "C-06", name: "Ridgeline Mining" },
      { id: "C-07", name: "Harbor Marine Supply" },
      { id: "C-08", name: "Placeholder Customer" },
    ],
    vendors: [
      { id: "V-100", name: "Apex Components", lead_time_days: 14 },
      { id: "V-200", name: "Brightline Supply", lead_time_days: 21 },
      { id: "V-300", name: "Cobalt Metals", lead_time_days: 30 },
    ],
    fg_items: [
      { item_no: "FG-1000", description: "Series 1000 pump assembly", series: "1000" },
      { item_no: "FG-2000", description: "Series 2000 pump assembly", series: "2000" },
      { item_no: "FG-3000", description: "Series 3000 pump assembly", series: "3000" },
      { item_no: "FG-6000", description: "Series 6000 pump assembly", series: "6000" },
    ],
    // Order matters: it is the order of the dashboard's status board among equal health.
    sales_lines: [
      { so_number: "S-ORD101001", line_no: "10", customer_id: "C-01", fg_item_no: "FG-1000", quantity: 10, unit_price: 685, order_date: "2026-09-20", delivery_date: "2026-10-22" },
      { so_number: "S-ORD101006", line_no: "20", customer_id: "C-02", fg_item_no: "FG-2000", quantity: 12, unit_price: 540, order_date: "2026-09-24", delivery_date: "2026-10-25" },
      { so_number: "S-ORD101005", line_no: "30", customer_id: "C-03", fg_item_no: "FG-1000", quantity: 8, unit_price: 685, order_date: "2026-09-25", delivery_date: "2026-10-28" },
      { so_number: "S-ORD101007", line_no: "40", customer_id: "C-04", fg_item_no: "FG-3000", quantity: 1, unit_price: 3200, order_date: "2026-10-02", delivery_date: "2026-11-15" },
      { so_number: "S-ORD101004", line_no: "50", customer_id: "C-05", fg_item_no: "FG-6000", quantity: 1, unit_price: 8900, order_date: "2026-09-30", delivery_date: "2026-11-23" },
      { so_number: "S-ORD101008", line_no: "60", customer_id: "C-06", fg_item_no: "FG-1000", quantity: 5, unit_price: 685, order_date: "2026-10-05", delivery_date: "2026-10-26" },
      { so_number: "S-ORD101003", line_no: "70", customer_id: "C-07", fg_item_no: "FG-3000", quantity: 2, unit_price: 3200, order_date: "2026-09-28", delivery_date: "2026-11-20" },
      { so_number: "S-ORD101002", line_no: "80", customer_id: "C-08", fg_item_no: "FG-2000", quantity: 6, unit_price: 540, order_date: "2026-09-22", delivery_date: "2026-11-30" },
    ],
    // 6 linked (S-ORD101007 and S-ORD101004 have none). End dates after the delivery date = late.
    production_orders: [
      { po_number: "P-ORD201001", so_number: "S-ORD101001", fg_item_no: "FG-1000", quantity: 10, start_date: "2026-10-12", end_date: "2026-10-27", status: "Released" },
      { po_number: "P-ORD201002", so_number: "S-ORD101006", fg_item_no: "FG-2000", quantity: 12, start_date: "2026-10-15", end_date: "2026-10-30", status: "Released" },
      { po_number: "P-ORD201003", so_number: "S-ORD101005", fg_item_no: "FG-1000", quantity: 8, start_date: "2026-10-19", end_date: "2026-11-02", status: "Planned" },
      { po_number: "P-ORD201004", so_number: "S-ORD101008", fg_item_no: "FG-1000", quantity: 5, start_date: "2026-10-14", end_date: "2026-10-24", status: "Released" },
      { po_number: "P-ORD201005", so_number: "S-ORD101003", fg_item_no: "FG-3000", quantity: 2, start_date: "2026-11-05", end_date: "2026-11-18", status: "Planned" },
      { po_number: "P-ORD201006", so_number: "S-ORD101002", fg_item_no: "FG-2000", quantity: 6, start_date: "2026-11-10", end_date: "2026-11-25", status: "Planned" },
    ],
    components: [
      { item_no: "CMP-A", description: "Impeller casting", uom: "EA", vendor_id: "V-100", unit_cost: 42, on_hand: 20 },
      { item_no: "CMP-B", description: "Shaft", uom: "EA", vendor_id: "V-200", unit_cost: 18, on_hand: 60 },
      { item_no: "CMP-C", description: "Seal kit", uom: "EA", vendor_id: "V-100", unit_cost: 9.5, on_hand: 10 },
      { item_no: "CMP-D", description: "Housing", uom: "EA", vendor_id: "V-300", unit_cost: 65, on_hand: 50 },
      { item_no: "CMP-E", description: "Control board", uom: "EA", vendor_id: "V-200", unit_cost: 120, on_hand: 0 },
      { item_no: "CMP-F", description: "Mounting plate", uom: "EA", vendor_id: "V-300", unit_cost: 14, on_hand: 10 },
    ],
    bom: [
      { fg_item_no: "FG-1000", component_item_no: "CMP-A", qty_per: 2 },
      { fg_item_no: "FG-1000", component_item_no: "CMP-B", qty_per: 1 },
      { fg_item_no: "FG-1000", component_item_no: "CMP-C", qty_per: 1 },
      { fg_item_no: "FG-2000", component_item_no: "CMP-B", qty_per: 1 },
      { fg_item_no: "FG-2000", component_item_no: "CMP-D", qty_per: 2 },
      { fg_item_no: "FG-3000", component_item_no: "CMP-C", qty_per: 1 },
      { fg_item_no: "FG-3000", component_item_no: "CMP-E", qty_per: 1 },
      { fg_item_no: "FG-6000", component_item_no: "CMP-A", qty_per: 1 },
      { fg_item_no: "FG-6000", component_item_no: "CMP-F", qty_per: 4 },
    ],
    // Late (receipt after need): V-PO-5001/1, V-PO-5002/1, V-PO-5003/1.
    vendor_po_lines: [
      { po_number: "V-PO-5001", line_no: "1", vendor_id: "V-100", component_item_no: "CMP-A", quantity: 8, need_date: "2026-10-18", receipt_date: "2026-10-24", status: "Open" },
      { po_number: "V-PO-5001", line_no: "2", vendor_id: "V-100", component_item_no: "CMP-A", quantity: 7, need_date: "2026-10-20", receipt_date: "2026-10-20", status: "Open" },
      { po_number: "V-PO-5002", line_no: "1", vendor_id: "V-100", component_item_no: "CMP-C", quantity: 6, need_date: "2026-10-21", receipt_date: "2026-10-30", status: "Open" },
      { po_number: "V-PO-5003", line_no: "1", vendor_id: "V-200", component_item_no: "CMP-B", quantity: 20, need_date: "2026-10-25", receipt_date: "2026-10-28", status: "Open" },
      { po_number: "V-PO-5004", line_no: "1", vendor_id: "V-300", component_item_no: "CMP-D", quantity: 30, need_date: "2026-11-05", receipt_date: "2026-11-03", status: "Open" },
    ],
  };
}
