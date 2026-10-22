// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAudit } from "@/server/audit";
import { installApi, type InstalledApi } from "../support/inprocess";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
});
afterEach(() => api.uninstall());

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
const CSV = [
  "Item No,Customer No,Quantity,Price,Currency,Effective Date",
  "FG-1000,ALL,0,700,USD,",
  "FG-2000,C-01,0,500,USD,",
  "FG-9999,ALL,0,10,USD,",
].join("\n");

async function stage(base = "/api/pricing", csv = CSV) {
  const r = await api.call("POST", `${base}/upload`, { filename: "prices.csv", content_b64: b64(csv), operator: "Tester" });
  expect(r.status).toBe(200);
  return r.body;
}

describe("sales pricing: book and overview", () => {
  it("seeds the price book from master data", async () => {
    const ov = (await api.call("GET", "/api/pricing/overview")).body;
    expect(ov.book).toMatchObject({ entries: 10, standard: 4, customer_specific: 6, items: 4 });
    expect(ov.bc).toMatchObject({ mode: "two-way", simulated: true });
    const std = (await api.call("GET", "/api/pricing/list?scope=standard")).body;
    expect(std.rows.map((r: { item_no: string; price: number }) => [r.item_no, r.price])).toEqual([["FG-1000", 685], ["FG-2000", 540], ["FG-3000", 3200], ["FG-6000", 8900]]);
    expect(std.rows[0].unit_cost).toBe(278.75);
    const c = (await api.call("GET", "/api/pricing/list?scope=customer&customer_no=C-01")).body;
    expect(c.rows).toHaveLength(2);
    expect(c.rows[0].customer_name).toBe("Northwind Water Utilities");
  });

  it("adds, warns about and deletes a single price", async () => {
    const bad = await api.call("PUT", "/api/pricing/entry", { operator: "T", item_no: "FG-1000", customer_no: "ALL", min_qty: 0, price: -1 });
    expect(bad.status).toBe(400);
    const unknown = await api.call("PUT", "/api/pricing/entry", { operator: "T", item_no: "NOPE", customer_no: "ALL", min_qty: 0, price: 5 });
    expect(unknown.status).toBe(400);
    const ok = await api.call("PUT", "/api/pricing/entry", { operator: "T", item_no: "FG-1000", customer_no: "C-02", min_qty: 5, price: 700, currency: "USD" });
    expect(ok.status).toBe(200);
    expect(ok.body.warnings.join(" ")).toMatch(/standard/);
    const del = await api.call("DELETE", "/api/pricing/entry?item_no=FG-1000&customer_no=C-02&min_qty=5&operator=T");
    expect(del.status).toBe(200);
    expect((await api.call("DELETE", "/api/pricing/entry?item_no=FG-1000&customer_no=C-02&min_qty=5&operator=T")).status).toBe(404);
    expect(listAudit(api.store, { source: "pricing" }).length).toBeGreaterThanOrEqual(2);
  });
});

describe("sales pricing: upload, review and apply", () => {
  it("stages rows with checks, then applies approved ones and pushes the BC item card", async () => {
    const batch = await stage();
    expect(batch.line_rows).toHaveLength(3);
    const [l1, l2, l3] = batch.line_rows;
    expect(l1.ai.flags).toEqual([]);
    expect(l1.payload.target).toBe("bc_item_card");
    expect(l1.ai.current_price).toBe(685);
    expect(l3.ai.flags[0].code).toBe("item_not_found");

    expect((await api.call("PATCH", `/api/pricing/lines/${l3.id}`, { operator: "T", decision: "approved" })).status).toBe(400);
    await api.call("PATCH", `/api/pricing/lines/${l1.id}`, { operator: "T", decision: "approved" });
    await api.call("PATCH", `/api/pricing/lines/${l2.id}`, { operator: "T", decision: "approved" });

    const res = (await api.call("POST", `/api/pricing/batches/${batch.id}/execute`, { operator: "T", push_to_bc: true, replace_existing: false, protect_governed: false, replace_mode: "retire", replace_scope: "price" })).body;
    expect(res).toMatchObject({ applied: 2, failed: 0, bc_item_cards_updated: 1, status: "partial" });
    expect(res.results[0]).toMatchObject({ item_no: "FG-1000", customer_no: "ALL", outcome: "updated", prev_price: 685 });

    const std = (await api.call("GET", "/api/pricing/list?scope=standard")).body.rows.find((r: { item_no: string }) => r.item_no === "FG-1000");
    expect(std).toMatchObject({ price: 700, prev_price: 685, change_pct: 2.2 });
    expect(std.bc_synced_at).toBeTruthy();
    const log = (await api.call("GET", "/api/pricing/log")).body;
    expect(log.filter((x: { action: string }) => x.action === "price_changed")).toHaveLength(2);
    expect(log[0].action).toBe("apply");
    const hist = (await api.call("GET", "/api/pricing/batches")).body;
    expect(hist[0]).toMatchObject({ id: batch.id, applied: 2, lines: 3 });
    expect((await api.call("GET", `/api/pricing/batches/${batch.id}/confirmation.xlsx`)).status).toBe(200);
  });

  it("protects governed prices when layering and flags duplicate files", async () => {
    const b = await stage();
    const l1 = b.line_rows[0];
    await api.call("PATCH", `/api/pricing/lines/${l1.id}`, { operator: "T", decision: "approved" });
    const r = (await api.call("POST", `/api/pricing/batches/${b.id}/execute`, { operator: "T", replace_existing: false, protect_governed: true })).body;
    expect(r).toMatchObject({ applied: 0, protected: 1 });
    const again = await stage();
    expect(again.summary.flags.map((f: { code: string }) => f.code)).toContain("duplicate_file");
  });

  it("previews and performs retire and delete of superseded prices", async () => {
    const b = await stage("/api/pricing", ["Item No,Customer No,Quantity,Price", "FG-1000,C-01,0,660"].join("\n"));
    await api.call("PATCH", `/api/pricing/lines/${b.line_rows[0].id}`, { operator: "T", decision: "approved" });
    const pv = (await api.call("POST", `/api/pricing/batches/${b.id}/replace-preview`, { operator: "T", replace_existing: true, replace_scope: "item_customer", replace_mode: "retire" })).body;
    expect(pv.book_total).toBe(2);
    expect(pv.bc_total).toBeGreaterThan(0);
    expect(pv.rows[0]).toMatchObject({ item_no: "FG-1000", customer_no: "C-01", book_count: 2 });
    const res = (await api.call("POST", `/api/pricing/batches/${b.id}/execute`, { operator: "T", replace_existing: true, replace_scope: "item_customer", replace_mode: "retire" })).body;
    expect(res.applied).toBe(1);
    const rows = (await api.call("GET", "/api/pricing/list?scope=customer&customer_no=C-01")).body.rows;
    expect(rows.map((r: { min_qty: number; price: number }) => [r.min_qty, r.price])).toEqual([[0, 660]]);
  });

  it("validates uploads and rejects xlsx", async () => {
    expect((await api.call("POST", "/api/pricing/upload", { filename: "a.csv" })).status).toBe(400);
    expect((await api.call("POST", "/api/pricing/upload", { filename: "a.xlsx", content_b64: b64("x") })).status).toBe(400);
    expect((await api.call("POST", "/api/pricing/upload", { filename: "a.csv", content_b64: b64("only header") })).status).toBe(400);
    expect((await api.call("GET", "/api/pricing/batches/B-99")).status).toBe(404);
    expect((await api.call("PATCH", "/api/pricing/lines/L-99", { decision: "approved" })).status).toBe(404);
  });

  it("rechecks rows after a settings change and archives a batch", async () => {
    const b = await stage();
    await api.call("PUT", "/api/pricing/settings", { operator: "T", values: { margin_floor_pct: 80 } });
    const rc = (await api.call("POST", `/api/pricing/batches/${b.id}/recheck`, { operator: "T" })).body;
    expect(rc.lines_rechecked).toBe(3);
    expect(rc.lines_changed).toBeGreaterThan(0);
    expect((await api.call("PUT", "/api/pricing/settings", { operator: "T", values: { margin_floor_pct: 500 } })).status).toBe(400);
    await api.call("POST", `/api/pricing/batches/${b.id}/archive`, { operator: "T" });
    expect((await api.call("GET", "/api/pricing/batches")).body).toHaveLength(0);
    expect((await api.call("GET", "/api/pricing/batches?archived=true")).body).toHaveLength(1);
  });
});

describe("sales pricing: connectors (simulated), derive, audit, jobs", () => {
  it("pulls from simulated BC and is idempotent", async () => {
    const first = (await api.call("POST", "/api/pricing/pull-bc", { operator: "T" })).body;
    expect(first).toMatchObject({ simulated: true, created: 1, updated: 1 });
    expect((await api.call("POST", "/api/pricing/pull-bc", { operator: "T" })).body).toMatchObject({ created: 0, updated: 0 });
    await api.call("PUT", "/api/pricing/settings", { operator: "T", values: { bc_mode: "offline" } });
    expect((await api.call("POST", "/api/pricing/pull-bc", { operator: "T" })).status).toBe(400);
  });

  it("syncs the external app only when configured, as a review batch", async () => {
    expect((await api.call("POST", "/api/pricing/sync-external", { operator: "T" })).status).toBe(400);
    await api.call("PUT", "/api/pricing/settings", { operator: "T", values: { external_app: { mode: "api", url: "https://example.invalid" } } });
    const b = (await api.call("POST", "/api/pricing/sync-external", { operator: "T" })).body;
    expect(b.status).toBe("review");
    expect(b.label).toMatch(/simulated/);
    expect(b.line_rows.length).toBe(6);
    expect((await api.call("GET", "/api/pricing/settings")).body.external_app.last_result).toMatch(/Simulated/);
  });

  it("derives a batch from posted invoices", async () => {
    const b = (await api.call("POST", "/api/pricing/derive", { operator: "T", months: 12 })).body;
    expect(b.line_rows.length).toBeGreaterThan(0);
    expect(b.source_kind).toBe("derive");
  });

  it("runs the rule-based audit, keeps reviewer decisions and requires a note to dismiss", async () => {
    const run = (await api.call("POST", "/api/pricing/audit/run", { operator: "T", window_days: 180 })).body;
    expect(run.run.summary.engine).toMatch(/not an LLM/);
    const a = (await api.call("GET", "/api/pricing/audit?status=open")).body;
    const checks = a.findings.map((f: { check_id: string }) => f.check_id);
    expect(checks).toContain("PA-03");
    expect(checks).toContain("PA-01");
    expect(a.last_run.summary.rating).toBe("at risk");
    const f = a.findings[0];
    expect((await api.call("PATCH", `/api/pricing/audit/${f.fingerprint}`, { operator: "T", status: "dismissed" })).status).toBe(400);
    expect((await api.call("PATCH", `/api/pricing/audit/${f.fingerprint}`, { operator: "T", status: "reviewed" })).body.status).toBe("reviewed");
    await api.call("POST", "/api/pricing/audit/run", { operator: "T", window_days: 180 });
    const all = (await api.call("GET", "/api/pricing/audit")).body.findings;
    expect(all.find((x: { fingerprint: string }) => x.fingerprint === f.fingerprint).status).toBe("reviewed");
    expect((await api.call("POST", "/api/pricing/audit/run", { operator: "T", window_days: 5 })).status).toBe(400);
  });

  it("manages and runs scheduled jobs", async () => {
    const jobs = (await api.call("GET", "/api/pricing/jobs")).body;
    expect(jobs).toHaveLength(2);
    const run = (await api.call("POST", `/api/pricing/jobs/${jobs[0].id}/run`, { operator: "T" })).body;
    expect(run.last_result.status).toBe("ok");
    const bad = (await api.call("POST", `/api/pricing/jobs/${jobs[1].id}/run`, { operator: "T" })).body;
    expect(bad.last_result.status).toBe("error");
    expect((await api.call("PUT", "/api/pricing/jobs", { operator: "T", job: { job_type: "nope", schedule: { frequency: "daily" } } })).status).toBe(400);
    const saved = (await api.call("PUT", "/api/pricing/jobs", { operator: "T", job: { name: "Pull", job_type: "pull_bc", enabled: true, schedule: { frequency: "hourly", every_hours: 2 }, criteria: {} } })).body;
    expect(saved.id).toBe("J-3");
    expect((await api.call("DELETE", `/api/pricing/jobs/${saved.id}`)).status).toBe(200);
    expect((await api.call("DELETE", `/api/pricing/jobs/${saved.id}`)).status).toBe(404);
  });
});

describe("purchase pricing family (/api/purchprice)", () => {
  it("uses vendor fields and the same workbench semantics", async () => {
    const ov = (await api.call("GET", "/api/purchprice/overview")).body;
    expect(ov.book).toMatchObject({ standard: 6 });
    expect(ov.book.vendor_specific).toBeGreaterThan(0);
    expect(ov.bc.mode).toBe("write-inert");
    const v = (await api.call("GET", "/api/purchprice/list?scope=vendor&vendor_no=V-100")).body;
    expect(v.rows[0].vendor_no).toBe("V-100");
    expect(v.rows[0].customer_no).toBeUndefined();
    const b = await stage("/api/purchprice", ["Item No,Vendor No,Quantity,Price", "CMP-A,V-100,0,60", "CMP-B,ALL,0,17"].join("\n"));
    expect(b.line_rows[0].payload.vendor_no).toBe("V-100");
    expect(b.line_rows[0].payload.target).toBe("price_book");
    expect(b.line_rows[0].ai.flags.map((f: { code: string }) => f.code)).toContain("price_far_above_cost");
    expect(b.line_rows[1].ai.margin_pct).toBe(5.6);
    await api.call("PATCH", `/api/purchprice/lines/${b.line_rows[1].id}`, { operator: "T", decision: "approved" });
    const r = (await api.call("POST", `/api/purchprice/batches/${b.id}/execute`, { operator: "T", push_to_bc: true, replace_existing: false, protect_governed: false })).body;
    expect(r).toMatchObject({ applied: 1, bc_item_cards_updated: 0 });
    // sales book is untouched
    expect((await api.call("GET", "/api/pricing/batches")).body).toHaveLength(0);
    await api.call("POST", "/api/purchprice/audit/run", { operator: "T", window_days: 180 });
    const f = (await api.call("GET", "/api/purchprice/audit")).body.findings;
    expect(f.some((x: { check_id: string }) => x.check_id === "PA-01")).toBe(true);
    expect(f[0].detail.vendor_no).toBeTruthy();
  });
});

describe("sales history", () => {
  it("merges open orders with posted invoices", async () => {
    const { entries } = (await api.call("GET", "/api/sales-history")).body;
    expect(entries.filter((e: { status: string }) => e.status === "open")).toHaveLength(8);
    expect(entries.filter((e: { status: string }) => e.status === "completed").length).toBeGreaterThan(0);
    expect(entries[0]).toMatchObject({ so_number: "S-ORD101001", customer_name: "Northwind Water Utilities", prod_order_no: "P-ORD201001" });
  });
});
