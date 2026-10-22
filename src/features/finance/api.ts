import { del, get, post, put, qs, request } from "@/lib/api/request";

// Client for /api/finance/** and /api/finops/**. Paths, verbs and request bodies follow the original
// client; response shapes are our own design (spec/finance.md).

export interface Bucket {
  key: string;
  label: string;
  amount: number;
  count: number;
}
export interface Aging<L> {
  total: number;
  buckets: Bucket[];
  lines: L[];
}
export interface ReceivableLine {
  so_number: string;
  line_no: string;
  customer_name: string;
  series: string | null;
  amount: number;
  delivery_date: string;
  due_date: string;
  days_to_due: number;
}
export interface PayableLine {
  po_number: string;
  line_no: string;
  vendor_name: string;
  component_item_no: string;
  amount: number;
  receipt_date: string;
  due_date: string;
  days_to_due: number;
}
export interface MarginRow {
  quantity: number;
  revenue: number;
  cost: number;
  margin: number;
  margin_pct: number;
}
export interface Operational {
  kpis: { open_receivables: number; overdue_receivables: number; open_commitments: number; revenue_at_risk: number; revenue_at_risk_pct: number; gross_margin_pct: number; min_cash: number };
  receivables: Aging<ReceivableLine>;
  payables: Aging<PayableLine>;
  margin: { series: (MarginRow & { series: string })[]; total: MarginRow };
  cash: {
    opening: number;
    weeks: { index: number; start: string; end: string; inflow: number; outflow: number; net: number; closing: number }[];
    beyond_horizon: { inflow: number; outflow: number };
  };
}
export interface Dashboard {
  year: number;
  month: number;
  date_to: string;
  as_of: string;
  gl: {
    revenue_month: number;
    expenses_month: number;
    net_income_month: number;
    revenue_ytd: number;
    net_income_ytd: number;
    gross_margin_pct_ytd: number;
    cash: number;
    receivables: number;
    inventory: number;
    payables: number;
    trial_balance_balanced: boolean;
    documents: number;
    lines: number;
  };
  months: { month: number; revenue: number; expenses: number; net_income: number }[];
  budget: { has_budget: boolean; revenue: { actual: number; budget: number; variance: number }; expenses: { actual: number; budget: number; variance: number } };
  operational: Operational;
}

export interface SyncStatus {
  status: string;
  simulated: boolean;
  connector: string;
  last_sync_at: string | null;
  last_mode: string | null;
  documents: number;
  lines: number;
}
export interface GlLine {
  id: number;
  document_no: string;
  posting_date: string;
  account_no: string;
  account_name: string;
  description: string;
  debit: number;
  credit: number;
  source: string;
}
export interface GlPage {
  total: number;
  limit: number;
  offset: number;
  totals: { debit: number; credit: number };
  lines: GlLine[];
}
export interface Facets {
  accounts: { account_no: string; name: string; count: number }[];
  sources: { source: string; count: number }[];
  years: number[];
  date_min: string | null;
  date_max: string | null;
}
export interface GlDocument {
  document_no: string;
  posting_date: string;
  source: string;
  description: string;
  lines: GlLine[];
  total_debit: number;
  total_credit: number;
  balanced: boolean;
}
export interface TrialBalance {
  date_from: string;
  date_to: string;
  rows: { account_no: string; name: string; type: string; opening: number; debit: number; credit: number; closing: number }[];
  totals: { opening: number; debit: number; credit: number; closing: number };
  balanced: boolean;
}
export interface IncomeStatement {
  year: number;
  month: number;
  sections: { title: string; normal: string; lines: { account_no: string; name: string; month: number; ytd: number }[]; month_total: number; ytd_total: number }[];
  net_income: { month: number; ytd: number };
  unmapped_accounts: string[];
}
export interface BalanceSheet {
  as_of: string;
  sections: { title: string; normal: string; lines: { account_no: string; name: string; balance: number }[]; total: number }[];
  current_earnings: number;
  total_debit_side: number;
  total_credit_side: number;
  balanced: boolean;
  unmapped_accounts: string[];
}
export interface BudgetEntry {
  account_no: string;
  month: number;
  amount: number;
}
export interface Budget {
  year: number;
  entries: BudgetEntry[];
  accounts: { account_no: string; name: string; type: string }[];
  total_revenue: number;
  total_expenses: number;
}

export const getDashboard = (year?: number, month?: number) => get<Dashboard>(`/api/finance/dashboard${qs({ year, month })}`);
export const getSyncStatus = () => get<SyncStatus>("/api/finance/sync/status");
export const runSync = (full: boolean) => post<SyncStatus & { added_lines: number }>("/api/finance/sync", { full });
export const getGl = (f: Record<string, string | number | undefined>) => get<GlPage>(`/api/finance/gl${qs(f)}`);
export const getFacets = () => get<Facets>("/api/finance/gl/facets");
export const getDocument = (id: string) => get<GlDocument>(`/api/finance/gl/document/${encodeURIComponent(id)}`);
export const getTrialBalance = (from: string, to: string) => get<TrialBalance>(`/api/finance/trial-balance?date_from=${from}&date_to=${to}`);
export const getIncomeStatement = (year: number, month: number) => get<IncomeStatement>(`/api/finance/income-statement?year=${year}&month=${month}`);
export const getBalanceSheet = (asOf: string) => get<BalanceSheet>(`/api/finance/balance-sheet?as_of=${asOf}`);
export const getBudget = (year: number) => get<Budget>(`/api/finance/budget?year=${year}`);
export const saveBudget = (year: number, entries: BudgetEntry[]) => put<Budget>("/api/finance/budget", { year, entries });
export const seedBudget = (year: number, source_year: number, factor: number) => post<Budget>("/api/finance/budget/seed", { year, source_year, factor });

// ---- finops ----

export interface Account {
  account_no: string;
  name: string;
  type: string;
  active: boolean;
  has_postings: boolean;
}
export interface Mapping {
  id: string;
  kind: string;
  key: string;
  value: string;
}
export interface Settings {
  customer_terms_days: number;
  vendor_terms_days: number;
  opening_cash: number;
}
export interface Job {
  id: string;
  name: string;
  description: string;
  kind: string;
  enabled: boolean;
  schedule: string;
  params: Record<string, number>;
  last_run_at: string | null;
  last_status: "ok" | "attention" | null;
}
export interface Run {
  id: string;
  job_name: string;
  as_of: string;
  status: "ok" | "attention";
  summary: string;
  items: { label: string; amount: number | null; note: string }[];
}
export interface LogEntry {
  id: number;
  ts: string;
  process: string;
  level: string;
  operator: string;
  message: string;
  ref: string | null;
}
export interface Finding {
  id: string;
  run_id: string;
  kind: string;
  severity: string;
  document_no: string;
  account_no: string | null;
  amount: number;
  message: string;
  status: string;
  note: string;
}
export interface Overview {
  accounts: { total: number; active: number };
  mappings: number;
  jobs: { total: number; enabled: number };
  log_entries: number;
  audit: { total: number; open: number };
  ledger: { documents: number; lines: number; balanced: boolean };
}
export interface Vendor {
  vendor_no: string;
  name: string;
  lead_time_days: number;
  open_po_lines: number;
  open_po_total: number;
  mapped_account: string | null;
}
export interface BankAccount {
  id: string;
  name: string;
  currency: string;
  gl_account_no: string;
  balance: number;
}
export interface FolderEntry {
  name: string;
  type: "folder" | "file";
  path: string;
  count?: number;
  amount?: number;
  posting_date?: string;
}

const F = "/api/finops";
export const getOverview = () => get<Overview>(`${F}/overview`);
export const getAccounts = (all: boolean) => get<{ accounts: Account[] }>(`${F}/gl-accounts${all ? "?all=true" : ""}`).then((r) => r.accounts);
export const refreshAccounts = () => post<{ accounts: number; activated: number; deactivated: number }>(`${F}/refresh-accounts`);
export const getMappings = () => get<{ mappings: Mapping[] }>(`${F}/mappings`).then((r) => r.mappings);
export const addMapping = (kind: string, key: string, value: string) => put<Mapping>(`${F}/mappings`, { kind, key, value });
export const deleteMapping = (id: string) => del(`${F}/mappings/${id}`);
export const getSettings = () => get<Settings>(`${F}/settings`);
export const saveSettings = (values: Partial<Settings>) => put<Settings>(`${F}/settings`, { values });
export const getLog = (process?: string) => get<{ entries: LogEntry[] }>(`${F}/log${qs({ process })}`).then((r) => r.entries);
export const runAudit = (window_days: number) => post<{ run_id: string; new_findings: number; open_findings: number; scanned_documents: number }>(`${F}/audit/run`, { window_days });
export const getFindings = (status?: string) => get<{ findings: Finding[] }>(`${F}/audit${qs({ status })}`).then((r) => r.findings);
export const patchFinding = (id: string, status: string, note: string) => request<Finding>(`${F}/audit/${id}`, { method: "PATCH", body: JSON.stringify({ status, note }) });
export const getJobs = () => get<{ jobs: Job[] }>(`${F}/jobs`).then((r) => r.jobs);
export const saveJob = (job: Partial<Job>) => put<Job>(`${F}/jobs`, { job });
export const deleteJob = (id: string) => del(`${F}/jobs/${id}`);
export const runJob = (id: string) => post<Run>(`${F}/jobs/${id}/run`, {});
export const getVendors = () => get<{ vendors: Vendor[] }>(`${F}/vendors`).then((r) => r.vendors);
export const getBankAccounts = () => get<{ accounts: BankAccount[] }>(`${F}/bank-accounts`).then((r) => r.accounts);
export const getHistory = (kind: string) => get<{ documents: { document_no: string; posting_date: string; description: string; amount: number }[] }>(`${F}/history?kind=${encodeURIComponent(kind)}`).then((r) => r.documents);
export const browse = (path: string) => get<{ path: string; entries: FolderEntry[] }>(`${F}/browse?path=${encodeURIComponent(path)}`);
export const folderStatus = (path: string) => get<{ path: string; files: number; total_amount: number; last_posting_date: string | null }>(`${F}/folder-status?path=${encodeURIComponent(path)}`);
