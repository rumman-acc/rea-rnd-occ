import { del, get, patch, post, put, qs } from "@/lib/api/request";
import type {
  ApplyResult, Batch, BatchHead, EntryInput, ExecuteOptions, Finding, Job, LineRow, LogEntry, Overview, PartyKey, PriceList,
  RecheckResult, ReplacePreview, Settings, AuditRun, BcInfo,
} from "./types";

/**
 * Client for one pricing API family. Sales: base "pricing" (/api/pricing/**); purchase: base
 * "purchprice" (/api/purchprice/**). Same methods, same shapes; only the party fields differ.
 */
export interface PricingApi {
  base: string;
  party: PartyKey;
  list(scope: "standard" | "party", partyNo?: string): Promise<PriceList>;
  overview(): Promise<Overview>;
  bcStatus(refresh?: boolean): Promise<BcInfo>;
  pullBc(operator: string): Promise<{ bc_lines: number; created: number; updated: number; unchanged: number }>;
  upload(filename: string, contentB64: string, operator: string): Promise<Batch>;
  derive(operator: string, months?: number): Promise<Batch>;
  syncExternal(operator: string): Promise<Batch>;
  batches(archived?: boolean): Promise<BatchHead[]>;
  batch(id: string): Promise<Batch>;
  patchLine(id: string, body: { operator: string; decision?: LineRow["decision"]; payload?: Record<string, unknown> }): Promise<LineRow>;
  execute(id: string, operator: string, o: ExecuteOptions): Promise<ApplyResult>;
  replacePreview(id: string, operator: string, o: { replace_existing: boolean; replace_scope: string; replace_mode: string }): Promise<ReplacePreview>;
  recheck(id: string, operator: string): Promise<RecheckResult>;
  archive(id: string, operator: string): Promise<unknown>;
  upsertEntry(operator: string, e: EntryInput): Promise<{ ok: boolean; warnings: string[] }>;
  deleteEntry(item: string, partyNo: string, minQty: number, operator: string): Promise<unknown>;
  settings(): Promise<Settings>;
  saveSettings(operator: string, values: Partial<Settings>): Promise<Settings>;
  log(limit?: number): Promise<LogEntry[]>;
  auditRun(operator: string, windowDays: number): Promise<unknown>;
  audit(status?: string): Promise<{ findings: Finding[]; last_run: AuditRun | null }>;
  patchFinding(fingerprint: string, operator: string, status: string, note?: string): Promise<Finding>;
  jobs(): Promise<Job[]>;
  saveJob(operator: string, job: Job): Promise<Job>;
  deleteJob(id: string): Promise<unknown>;
  runJob(id: string, operator: string): Promise<Job>;
  /** Plain URLs for browser downloads. */
  sourceUrl(id: string): string;
  confirmationUrl(id: string): string;
}

export function createPricingApi(base: "pricing" | "purchprice", party: PartyKey): PricingApi {
  const r = `/api/${base}`;
  const pk = `${party}_no`;
  const partyIn = (o: EntryInput) => {
    const { party_no, ...rest } = o;
    return { ...rest, [pk]: party_no };
  };
  return {
    base: r,
    party,
    list: (scope, no) => get(`${r}/list${qs({ scope: scope === "standard" ? "standard" : party, [pk]: no })}`),
    overview: () => get(`${r}/overview`),
    bcStatus: (refresh = false) => get(`${r}/bc-status?refresh=${refresh}`),
    pullBc: (operator) => post(`${r}/pull-bc`, { operator }),
    upload: (filename, content_b64, operator) => post(`${r}/upload`, { filename, content_b64, operator, options: {} }),
    derive: (operator, months = 12) => post(`${r}/derive`, { operator, months }),
    syncExternal: (operator) => post(`${r}/sync-external`, { operator }),
    batches: (archived = false) => get(`${r}/batches?archived=${archived}`),
    batch: (id) => get(`${r}/batches/${id}`),
    patchLine: (id, body) => patch(`${r}/lines/${id}`, body),
    execute: (id, operator, o) => post(`${r}/batches/${id}/execute`, { operator, ...o }),
    replacePreview: (id, operator, o) => post(`${r}/batches/${id}/replace-preview`, { operator, ...o }),
    recheck: (id, operator) => post(`${r}/batches/${id}/recheck`, { operator }),
    archive: (id, operator) => post(`${r}/batches/${id}/archive`, { operator }),
    upsertEntry: (operator, e) => put(`${r}/entry`, { operator, ...partyIn(e) }),
    deleteEntry: (item, no, minQty, operator) =>
      del(`${r}/entry?item_no=${encodeURIComponent(item)}&${pk}=${encodeURIComponent(no)}&min_qty=${minQty}&operator=${encodeURIComponent(operator)}`),
    settings: () => get(`${r}/settings`),
    saveSettings: (operator, values) => put(`${r}/settings`, { operator, values }),
    log: (limit = 300) => get(`${r}/log?limit=${limit}`),
    auditRun: (operator, window_days) => post(`${r}/audit/run`, { operator, window_days }),
    audit: (status) => get(`${r}/audit${status ? `?status=${status}` : ""}`),
    patchFinding: (fp, operator, status, note = "") => patch(`${r}/audit/${fp}`, { operator, status, note }),
    jobs: () => get(`${r}/jobs`),
    saveJob: (operator, job) => put(`${r}/jobs`, { operator, job }),
    deleteJob: (id) => del(`${r}/jobs/${id}`),
    runJob: (id, operator) => post(`${r}/jobs/${id}/run`, { operator }),
    sourceUrl: (id) => `${r}/batches/${id}/source`,
    confirmationUrl: (id) => `${r}/batches/${id}/confirmation.xlsx`,
  };
}

export const salesPricingApi = createPricingApi("pricing", "customer");
export const purchasePricingApi = createPricingApi("purchprice", "vendor");
