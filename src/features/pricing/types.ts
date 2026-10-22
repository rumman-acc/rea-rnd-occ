// Wire types of the pricing API (response shapes are our own design, P).
// Party fields come as customer_* (sales) or vendor_* (purchase); use `partyNo` / `partyName`.

export type PartyKey = "customer" | "vendor";

export interface PartyRef {
  number: string;
  name: string;
}

export type Party = { customer_no?: string; customer_name?: string; vendor_no?: string; vendor_name?: string };

export interface PriceRow extends Party {
  item_no: string;
  item_description: string;
  item_blocked: boolean;
  min_qty: number;
  price: number;
  prev_price: number | null;
  change_pct: number | null;
  unit_cost: number | null;
  margin_pct: number | null;
  currency: string;
  effective_from: string;
  updated_at: string | null;
  updated_by: string;
  source: string;
  bc_synced_at: string | null;
}

export interface PriceList extends Record<string, unknown> {
  rows: PriceRow[];
  book: { standard: number; last_updated: string | null } & Record<string, number | string | null>;
  priced: string[];
  customers?: PartyRef[];
  vendors?: PartyRef[];
}

export interface BcInfo {
  mode: "two-way" | "read-only" | "write-inert" | "offline";
  read: boolean;
  write: boolean;
  detail: string;
  warning: string;
  simulated: boolean;
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
  bc_mode: BcInfo["mode"];
  external_app: ExternalApp;
}

export interface Overview {
  book: Record<string, number | string | null>;
  batches_in_review: number;
  lines_pending: number;
  open_findings: number;
  last_audit: { ts: string; summary: { rating: string } } | null;
  bc: BcInfo;
  settings: Settings;
}

export interface Flag {
  level: "red" | "yellow";
  code: string;
  text: string;
}

export interface LinePayload extends Party {
  item_no: string;
  item_description?: string;
  min_qty: number;
  price: number;
  currency: string;
  uom?: string;
  effective_from?: string;
  target: "bc_item_card" | "price_book";
  replace_existing: boolean | null;
}

export interface LineRow {
  id: string;
  row_no: number;
  payload: LinePayload;
  ai: {
    current_price: number | null;
    applicable_price: number | null;
    unit_cost: number | null;
    margin_pct: number | null;
    delta_pct: number | null;
    flags: Flag[];
  };
  decision: "pending" | "approved" | "excluded";
  status: "staged" | "applied" | "failed";
  result: Record<string, unknown>;
}

export interface BatchHead {
  id: string;
  label: string;
  source_file: string;
  source_kind: string;
  operator: string;
  uploaded_at: string;
  status: "review" | "applied" | "partial" | "failed" | "archived";
  lines: number;
  applied: number;
  summary: { items: number; rows: number; flags: Flag[]; targets: { bc_item_card: number } };
  simulated: boolean;
}

export interface Batch extends BatchHead {
  line_rows: LineRow[];
}

export interface ApplyResult extends Record<string, unknown> {
  batch_id: string;
  applied: number;
  failed: number;
  protected: number;
  bc_item_cards_updated: number;
  results: ({ status: string; bc_history_line?: boolean } & Party)[];
  confirmation: boolean;
}

export interface ReplacePreview {
  book_total: number;
  bc_total: number;
  scope_label: string;
  bc_readable: boolean;
  legacy_note: string;
  rows: ({ row_no: number; item_no: string; book_count: number; bc_count: number; book: { price: number; min_qty: number }[] } & Party)[];
}

export interface RecheckResult {
  lines_rechecked: number;
  lines_changed: number;
  changes: { row_no: number; subject: string; unit_cost_before: number | null; unit_cost_after: number | null; flags_after: string[] }[];
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
  detail: Party & { documents?: string[]; items?: string[]; doc_kind?: string };
}

export interface AuditRun {
  ts: string;
  operator: string;
  window_days: number;
  summary: {
    engine: string;
    rating: string;
    narrative: string;
    recommendations: string[];
    counts: { high?: number; medium?: number; low?: number };
    risk_impact: number;
    priced_lines: number;
    documents_scanned: number;
  };
}

export interface Job {
  id?: string;
  name: string;
  job_type: "inbox" | "audit" | "sync" | "pull_bc";
  enabled: boolean;
  schedule: { frequency: "daily" | "weekly" | "hourly"; time?: string; weekday?: number; every_hours?: number };
  criteria: Record<string, unknown>;
  last_run?: string | null;
  last_result?: { status?: string; findings?: number; files?: number; error?: string } | null;
}

export interface EntryInput {
  item_no: string;
  party_no: string;
  min_qty: number;
  price: number;
  currency: string;
  uom?: string;
  effective_from?: string;
}

export interface ExecuteOptions {
  line_ids?: string[];
  push_to_bc: boolean;
  replace_existing: boolean;
  replace_scope: string;
  protect_governed: boolean;
  replace_mode: "retire" | "delete";
}

export const partyNo = (o: Party, k: PartyKey): string => (k === "customer" ? o.customer_no : o.vendor_no) ?? "";
export const partyName = (o: Party, k: PartyKey): string => (k === "customer" ? o.customer_name : o.vendor_name) ?? "";
