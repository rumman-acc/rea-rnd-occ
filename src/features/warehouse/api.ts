import { get, post, put, qs } from "@/lib/api/request";

export interface Bin {
  code: string;
  zone: string;
}
export interface StockRow {
  item_no: string;
  zone: string;
  bin: string;
  lot: string;
  qty: number;
}
export interface ReceivingLine {
  line_id: string;
  sequence: number;
  item_no: string;
  description: string;
  ordered: number;
  received: number;
  outstanding: number;
  suggested_bin: string;
  lot_required: boolean;
  overdue: boolean;
  expected_date: string;
}
export interface ReceivedLine {
  receipt_date: string;
  item_no: string;
  qty: number;
  lot_no: string;
  bin_code: string;
  operator: string;
}
export interface ReceivingPo {
  po_id: string;
  po_number: string;
  vendor_no: string;
  vendor_name: string;
  expected_date: string;
  status: string;
  releasable: boolean;
  lines: ReceivingLine[];
  received_lines: ReceivedLine[];
}
export interface ReceivingTodo {
  pos: ReceivingPo[];
  al_mode: boolean;
  location: string;
  settings?: { over_delivery_tolerance_pct: number };
}
export interface ReceiptRequestLine {
  line_id: string;
  sequence: number;
  item_no: string;
  qty: number;
  lot_no: string;
  bin_code: string;
  close_line: boolean;
}
export interface ReceiptResult {
  status: string;
  errors?: string[];
  lines?: { line_id: string; item_no: string; result: string; error?: string }[];
  posting_date_change?: { changed: boolean; before: string; after: string; error?: string };
}
export interface MovementRequest {
  kind: "move" | "adjust";
  item_no: string;
  qty: number;
  lot_no: string;
  from_bin: string;
  to_bin: string;
  bin_code: string;
  reason: string;
}
export interface MovementResult {
  type: string;
  status: string;
  item_no: string;
  qty?: number;
  from_bin?: string;
  to_bin?: string;
  bin_code?: string;
  lot_no?: string;
  error?: string;
}
export interface CompletedPo {
  po_id: string;
  po_number: string;
  vendor_no: string;
  vendor_name: string;
  last_receipt_date: string;
  received_via_app: boolean;
  received_lines: ReceivedLine[];
}
export interface OrderLine {
  item_no: string;
  description: string;
  ordered: number;
  received: number;
}
export interface WhSettings {
  over_delivery_tolerance_pct: number;
  printer: { label_printer: string; document_printer: string };
  scanner: { mode: string };
  barcode: { symbology: string };
}
export interface HistoryEntry {
  id: number;
  ts: string;
  type: "receipt" | "move" | "adjust";
  status: string;
  operator: string;
  po_number?: string;
  item_no?: string;
  qty?: number;
  lot_no?: string;
  from_bin?: string;
  to_bin?: string;
  bin_code?: string;
  reason?: string;
  error?: string;
  lines?: { item_no: string; qty: number; lot_no?: string; bin_code?: string }[];
}

/** Operator override stored in the browser; the server falls back to the signed-in user. */
export function storedOperator(): string | undefined {
  try {
    return localStorage.getItem("occ_operator") || undefined;
  } catch {
    return undefined;
  }
}

export const whApi = {
  receiving: () => get<ReceivingTodo>("/api/cockpit/receiving"),
  bins: () => get<Bin[]>("/api/cockpit/bins"),
  itemStock: (item: string) => get<StockRow[]>(`/api/cockpit/item-stock${qs({ item_no: item })}`),
  postReceipt: (body: { po_id: string; po_number: string; receipt_date: string; lines: ReceiptRequestLine[] }) =>
    post<ReceiptResult>("/api/cockpit/receive", { ...body, operator: storedOperator() }),
  postMovement: (body: MovementRequest) => post<MovementResult>("/api/cockpit/movement", { ...body, operator: storedOperator() }),
  completedPos: () => get<CompletedPo[]>("/api/cockpit/completed-pos"),
  poReceivedLines: (poId: string) => get<OrderLine[]>(`/api/cockpit/po-received-lines${qs({ po_id: poId })}`),
  settings: () => get<WhSettings>("/api/cockpit/warehouse-settings"),
  saveSettings: (values: WhSettings) => put<WhSettings>("/api/cockpit/warehouse-settings", { operator: storedOperator(), values }),
  history: (kind = "") => get<HistoryEntry[]>(`/api/cockpit/warehouse-history?kind=${encodeURIComponent(kind)}`),
};
