import { todayIsoDate } from "@/server/clock";
import { badRequest, notFound, type Ctx } from "@/server/http";
import { documents } from "./data";
import * as e from "./engine";
import { open } from "./state";
import type { Domain } from "./types";

type C = Ctx<Record<string, string>>;
type Body = Record<string, unknown>;

const op = (c: C, b: Body) => (typeof b.operator === "string" && b.operator.trim() ? b.operator.trim() : c.actor);
const text = (body: string, type: string, name: string) =>
  new Response(body, { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"` } });

/**
 * Handler bodies for one pricing family. Route files wrap these with handle().
 * Query/body names follow the original API client (customer_* for sales, vendor_* for purchase).
 */
export function pricing(d: Domain) {
  const st = (c: C) => open(c.store, d);
  const key = d === "sales" ? "customer_no" : "vendor_no";
  return {
    list: (c: C) => e.list(st(c), c.url.searchParams.get("scope") ?? "standard", c.url.searchParams.get(key) ?? undefined),
    overview: (c: C) => e.overview(st(c)),
    bcStatus: (c: C) => e.bcStatus(st(c)),
    pullBc: async (c: C) => e.pullBc(st(c), op(c, await c.json())),
    upload: async (c: C) => {
      const b = await c.json<Body>();
      return e.upload(st(c), b, op(c, b));
    },
    derive: async (c: C) => {
      const b = await c.json<Body>();
      return e.derive(st(c), Number(b.months ?? 12), op(c, b));
    },
    syncExternal: async (c: C) => e.syncExternal(st(c), op(c, await c.json())),
    batches: (c: C) => {
      const s = st(c);
      const archived = c.url.searchParams.get("archived") === "true";
      return s.batches
        .filter((b) => archived || b.status !== "archived")
        .map((b) => e.batchHead(s, b))
        .reverse();
    },
    batch: (c: C) => {
      const s = st(c);
      return e.batchDetail(s, e.findBatch(s, c.params.id));
    },
    source: (c: C) => {
      const b = e.findBatch(st(c), c.params.id);
      return text(b.source_text, "text/csv", b.source_file.endsWith(".csv") ? b.source_file : `${b.id}.csv`);
    },
    confirmation: (c: C) => {
      const b = e.findBatch(st(c), c.params.id);
      if (!b.confirmation) throw notFound("No confirmation record yet: nothing was applied in this batch.");
      // Rebuild limit: a CSV, not an XLSX workbook, is produced even at this path.
      return text(b.confirmation, "text/csv", `${b.id}-confirmation.csv`);
    },
    execute: async (c: C) => {
      const b = await c.json<Body>();
      return e.execute(st(c), c.params.id, b, op(c, b));
    },
    replacePreview: async (c: C) => e.replacePreview(st(c), c.params.id, await c.json()),
    recheck: async (c: C) => e.recheck(st(c), c.params.id, op(c, await c.json())),
    archive: async (c: C) => e.archive(st(c), c.params.id, op(c, await c.json())),
    patchLine: async (c: C) => {
      const b = await c.json<Body>();
      return e.patchLine(st(c), c.params.id, b, op(c, b));
    },
    upsertEntry: async (c: C) => {
      const b = await c.json<Body>();
      return e.upsertEntry(st(c), b, op(c, b));
    },
    deleteEntry: (c: C) => {
      const q = c.url.searchParams;
      const item = q.get("item_no");
      const party = q.get(key);
      const qty = Number(q.get("min_qty"));
      if (!item || !party || !Number.isFinite(qty)) throw badRequest(`item_no, ${key} and min_qty are required`);
      return e.deleteEntry(st(c), item, party, qty, q.get("operator") || c.actor);
    },
    settings: (c: C) => st(c).settings,
    saveSettings: async (c: C) => {
      const b = await c.json<Body>();
      return e.putSettings(st(c), b, op(c, b));
    },
    log: (c: C) => {
      const s = st(c);
      const n = Number(c.url.searchParams.get("limit") ?? 300);
      return s.log
        .slice()
        .reverse()
        .slice(0, Number.isFinite(n) && n > 0 ? n : 300);
    },
    audit: (c: C) => e.auditView(st(c), c.url.searchParams.get("status")),
    auditRun: async (c: C) => {
      const b = await c.json<Body>();
      return e.runAudit(st(c), Number(b.window_days ?? 180), op(c, b));
    },
    patchFinding: async (c: C) => {
      const b = await c.json<Body>();
      return e.patchFinding(st(c), c.params.fingerprint, b, op(c, b));
    },
    jobs: (c: C) => st(c).jobs,
    saveJob: async (c: C) => {
      const b = await c.json<Body>();
      return e.saveJob(st(c), b, op(c, b));
    },
    deleteJob: (c: C) => e.deleteJob(st(c), c.params.id, c.actor),
    runJob: async (c: C) => e.runJob(c.store, d, c.params.id, op(c, await c.json())),
  };
}

/** GET /api/sales-history: open order lines merged with posted invoices (synthetic, P). */
export function salesHistory(c: C) {
  const docs = documents(c.store, "sales");
  const today = todayIsoDate();
  return {
    entries: docs.map((x) => ({
      so_number: x.doc_no, customer_no: x.party_no, customer_name: x.party_name, item_no: x.item_no, description: x.description,
      series: x.series, model: x.model, promised_date: x.date, first_invoice_date: x.doc_kind === "invoice" ? x.date : null,
      last_invoice_date: x.doc_kind === "invoice" ? x.date : null, qty_ordered: x.qty, qty_shipped: x.doc_kind === "invoice" ? x.qty : 0,
      amount_ordered: x.qty * x.unit_price, amount_shipped: x.doc_kind === "invoice" ? x.qty * x.unit_price : 0, unit_price: x.unit_price,
      status: x.status, prod_order_no: x.prod_order_no, as_of: today,
    })),
  };
}
