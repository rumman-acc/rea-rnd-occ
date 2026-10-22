// Pricing workbench types (module M-PRC). Everything here is our own design (P):
// the original's response schemas are unknown; field names follow what the page chunks read.

export type Domain = "sales" | "purchase";
export type ReplaceMode = "retire" | "delete";
export type ReplaceScope = "price" | "item_party" | "item_all";
export type BcMode = "two-way" | "read-only" | "write-inert" | "offline";

/** Stored with canonical party fields; the wire layer renames to customer_* / vendor_*. */
export interface PriceEntry {
  item_no: string;
  item_description: string;
  party_no: string; // "ALL" for the standard price
  party_name: string;
  min_qty: number;
  price: number;
  prev_price: number | null;
  currency: string;
  uom: string;
  effective_from: string;
  ends_on: string | null;
  updated_at: string;
  updated_by: string;
  source: string;
  bc_synced_at: string | null;
  governed: boolean;
}

export interface Flag {
  level: "red" | "yellow";
  code: string;
  text: string;
}

export interface LinePayload {
  item_no: string;
  item_description?: string;
  party_no: string;
  party_name?: string;
  min_qty: number;
  price: number;
  currency: string;
  uom?: string;
  effective_from?: string;
  target: "bc_item_card" | "price_book";
  replace_existing: boolean | null;
}

export interface LineAi {
  current_price: number | null;
  applicable_price: number | null;
  unit_cost: number | null;
  margin_pct: number | null;
  delta_pct: number | null;
  flags: Flag[];
}

export interface BatchLine {
  id: string;
  row_no: number;
  payload: LinePayload;
  ai: LineAi;
  decision: "pending" | "approved" | "excluded";
  status: "staged" | "applied" | "failed";
  result: Record<string, unknown>;
}

export type BatchStatus = "review" | "applied" | "partial" | "failed" | "archived";

export interface Batch {
  id: string;
  label: string;
  source_file: string;
  source_kind: "upload" | "derive" | "external" | "inbox";
  source_text: string;
  file_hash: string;
  operator: string;
  uploaded_at: string;
  status: BatchStatus;
  summary: { items: number; rows: number; flags: Flag[]; targets: { bc_item_card: number } };
  lines: BatchLine[];
  confirmation: string | null;
}

export interface LogEntry {
  id: number;
  ts: string;
  operator: string;
  action: string;
  outcome: "ok" | "failed";
  ref: string;
  detail: Record<string, unknown>;
}

export interface Finding {
  fingerprint: string;
  severity: "high" | "medium" | "low";
  kind: "risk" | "opportunity";
  check_id: string;
  title: string;
  impact: number;
  status: "open" | "reviewed" | "dismissed" | "resolved";
  first_seen: string;
  last_seen: string;
  note: string;
  detail: Record<string, unknown>;
}

export interface AuditSummary {
  engine: string;
  rating: string;
  narrative: string;
  recommendations: string[];
  counts: { high: number; medium: number; low: number };
  risk_impact: number;
  priced_lines: number;
  documents_scanned: number;
}

export interface AuditRun {
  ts: string;
  operator: string;
  window_days: number;
  summary: AuditSummary;
}

export type JobType = "inbox" | "audit" | "sync" | "pull_bc";

export interface Job {
  id: string;
  name: string;
  job_type: JobType;
  enabled: boolean;
  schedule: { frequency: "daily" | "weekly" | "hourly"; time?: string; weekday?: number; every_hours?: number };
  criteria: Record<string, unknown>;
  last_run: string | null;
  last_result: Record<string, unknown> | null;
}

export interface ExternalApp {
  mode: "none" | "file" | "api";
  path: string;
  url: string;
  api_key_env: string;
  last_sync: string;
  last_result: string;
}

export interface Settings {
  margin_floor_pct: number;
  max_change_pct: number;
  overhead_pct: number;
  bc_mode: BcMode;
  external_app: ExternalApp;
}

export interface BcLine {
  item_no: string;
  party_no: string;
  min_qty: number;
  price: number;
  currency: string;
  ends_on: string | null;
}

export interface BcState {
  lines: BcLine[];
  item_cards: Record<string, number>;
}

export interface Document {
  doc_no: string;
  doc_kind: "order" | "invoice";
  party_no: string;
  party_name: string;
  item_no: string;
  description: string;
  series: string;
  model: string;
  qty: number;
  unit_price: number;
  date: string;
  status: "open" | "completed";
  prod_order_no: string | null;
}
