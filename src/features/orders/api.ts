import { get } from "@/lib/api/request";

export interface SalesHistoryEntry {
  so_number: string;
  customer_no: string;
  customer_name: string;
  item_no: string;
  description: string;
  series: string;
  model: string;
  promised_date: string | null;
  first_invoice_date: string | null;
  last_invoice_date: string | null;
  qty_ordered: number;
  qty_shipped: number;
  amount_ordered: number;
  amount_shipped: number;
  unit_price: number;
  status: "open" | "completed";
  prod_order_no: string | null;
}

export const getSalesHistory = () => get<{ entries: SalesHistoryEntry[] }>("/api/sales-history");
