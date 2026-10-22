export interface Bin {
  code: string;
  zone: string;
}
export interface StockRow {
  item_no: string;
  bin: string;
  lot: string;
  qty: number;
}
export interface WhSettings {
  over_delivery_tolerance_pct: number;
  printer: { label_printer: string; document_printer: string };
  scanner: { mode: string };
  barcode: { symbology: string };
}
export interface LineState {
  ordered: number;
  received: number;
}
export interface HistoryLine {
  line_id?: string;
  item_no: string;
  qty: number;
  lot_no: string;
  bin_code: string;
}
export interface HistoryEntry {
  id: number;
  ts: string;
  type: "receipt" | "move" | "adjust";
  status: "posted" | "rejected" | "failed";
  operator: string;
  po_number?: string;
  receipt_date?: string;
  item_no?: string;
  qty?: number;
  lot_no?: string;
  from_bin?: string;
  to_bin?: string;
  bin_code?: string;
  reason?: string;
  error?: string;
  errors?: string[];
  lines?: HistoryLine[];
}
export interface LegacyPo {
  po_number: string;
  vendor_id: string;
  last_receipt_date: string;
  lines: { item_no: string; ordered: number; received: number }[];
}
