// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAudit } from "@/server/audit";
import { installApi, type InstalledApi } from "../support/inprocess";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
});
afterEach(() => api.uninstall());

const get = async (p: string) => (await api.call("GET", p)).body;
const run = (id: string, body: unknown = {}) => api.call("POST", `/api/finops/jobs/${id}/run`, body);
const saveJob = (job: unknown) => api.call("PUT", "/api/finops/jobs", { operator: "pat", job });

describe("accounts, settings, overview (AC-FOP-001)", () => {
  it("lists active accounts by default and all on request; refresh re-derives activity", async () => {
    expect((await get("/api/finops/gl-accounts")).accounts).toHaveLength(8);
    const all = (await get("/api/finops/gl-accounts?all=true")).accounts;
    expect(all).toHaveLength(12);
    expect(all.find((a: any) => a.account_no === "6100")).toMatchObject({ active: false, has_postings: true });
    expect((await api.call("POST", "/api/finops/refresh-accounts")).body).toEqual({ accounts: 12, activated: 1, deactivated: 0 });
    expect((await get("/api/finops/gl-accounts")).accounts).toHaveLength(9);
    expect((await get("/api/finops/log?process=accounts")).entries).toHaveLength(1);
  });

  it("settings round trip with validation and logging", async () => {
    expect(await get("/api/finops/settings")).toEqual({ customer_terms_days: 30, vendor_terms_days: 30, opening_cash: 250000 });
    const r = await api.call("PUT", "/api/finops/settings", { operator: "pat", values: { customer_terms_days: 0 } });
    expect(r.body.customer_terms_days).toBe(0);
    expect((await get("/api/finance/dashboard")).operational.receivables.lines[0].due_date).toBe("2026-10-22");
    for (const values of [{ customer_terms_days: 400 }, { opening_cash: -1 }, { nope: 1 }, "x"]) {
      expect((await api.call("PUT", "/api/finops/settings", { values })).status).toBe(400);
    }
    expect((await get("/api/finops/log?process=settings")).entries[0]).toMatchObject({ operator: "pat", process: "settings" });
    expect(listAudit(api.store, { source: "finance" }).some((e) => e.action === "settings.update")).toBe(true);
  });

  it("opening cash change applies on a full sync", async () => {
    await api.call("PUT", "/api/finops/settings", { values: { opening_cash: 100000 } });
    await api.call("POST", "/api/finance/sync", { full: true });
    expect((await get("/api/finance/dashboard")).gl.cash).toBe(69880);
  });

  it("overview counts", async () => {
    expect(await get("/api/finops/overview")).toMatchObject({
      accounts: { total: 12, active: 8 },
      mappings: 0,
      jobs: { total: 5, enabled: 3 },
      audit: { total: 0, open: 0 },
      ledger: { balanced: true },
    });
  });
});

describe("mappings validation", () => {
  it("rejects bad input and lists by kind", async () => {
    const put = (b: unknown) => api.call("PUT", "/api/finops/mappings", b);
    expect((await put({ kind: "x", key: "1", value: "4000" })).status).toBe(400);
    expect((await put({ kind: "series-account", key: "", value: "4000" })).status).toBe(400);
    expect((await put({ kind: "series-account", key: "9999", value: "4000" })).status).toBe(400);
    expect((await put({ kind: "series-account", key: "1000", value: "5000" })).status).toBe(400);
    expect((await put({ kind: "series-account", key: "1000", value: "0000" })).status).toBe(400);
    expect((await put({ kind: "vendor-account", key: "V-XXX", value: "1200" })).status).toBe(400);
    expect((await put({ kind: "vendor-account", key: "V-100", value: "4000" })).status).toBe(400);
    expect((await put({ kind: "vendor-account", key: "V-100", value: "6100" })).status).toBe(200);
    expect((await put({ kind: "vendor-account", key: "V-100", value: "1200" })).body.id).toBe("M-0001");
    expect((await get("/api/finops/mappings?kind=vendor-account")).mappings).toHaveLength(1);
    expect((await get("/api/finops/mappings?kind=series-account")).mappings).toHaveLength(0);
    expect((await api.call("GET", "/api/finops/mappings?kind=zzz")).status).toBe(400);
  });

  it("a vendor mapping moves bill postings", async () => {
    await api.call("PUT", "/api/finops/mappings", { kind: "vendor-account", key: "V-300", value: "6100" });
    await api.call("POST", "/api/finance/sync", { full: true });
    const t = await get("/api/finance/trial-balance?date_from=2026-01-01&date_to=2026-12-31");
    expect(t.balanced).toBe(true);
    expect(t.rows.find((r: any) => r.account_no === "6100").debit).toBe(2070);
  });
});

describe("audit (AC-FOP-002)", () => {
  it("finds the posting to an inactive account, de-duplicates, and tracks status", async () => {
    const r = (await api.call("POST", "/api/finops/audit/run", { operator: "pat" })).body;
    expect(r).toMatchObject({ run_id: "AUD-0001", window_days: 90, new_findings: 1, open_findings: 1 });
    const f = (await get("/api/finops/audit")).findings;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ id: "F-0001", kind: "inactive-account", document_no: "MAN-0001", account_no: "6100", status: "open", amount: 120 });
    expect((await api.call("POST", "/api/finops/audit/run", {})).body.new_findings).toBe(0);
    const p = await api.call("PATCH", "/api/finops/audit/F-0001", { operator: "pat", status: "acknowledged", note: "freight, ok" });
    expect(p.body).toMatchObject({ status: "acknowledged", note: "freight, ok", updated_by: "pat" });
    expect((await get("/api/finops/audit?status=open")).findings).toHaveLength(0);
    expect((await get("/api/finops/audit?status=acknowledged")).findings).toHaveLength(1);
    expect((await get("/api/finops/log?process=audit")).entries.length).toBe(3);
  });

  it("window and validation", async () => {
    expect((await api.call("POST", "/api/finops/audit/run", { window_days: 1 })).body).toMatchObject({ scanned_documents: 0, new_findings: 0 });
    for (const w of [0, 1.5, "x", 5000]) expect((await api.call("POST", "/api/finops/audit/run", { window_days: w })).status).toBe(400);
    expect((await api.call("PATCH", "/api/finops/audit/F-9999", { status: "resolved" })).status).toBe(404);
    expect((await api.call("PATCH", "/api/finops/audit/F-0001", { status: "bogus" })).status).toBe(400);
    expect((await api.call("GET", "/api/finops/audit?status=bogus")).status).toBe(400);
  });
});

describe("jobs and run log (AC-FOP-003)", () => {
  it("seeds jobs", async () => {
    const jobs = (await get("/api/finops/jobs")).jobs;
    expect(jobs.map((j: any) => [j.id, j.enabled])).toEqual([
      ["dunning", true],
      ["po-approval", true],
      ["revenue-risk-alert", false],
      ["month-end-close", false],
      ["gl-balance-check", true],
    ]);
  });

  it("create, update, run, delete", async () => {
    const created = await saveJob({ name: "Risk 80", kind: "revenue-risk-alert", enabled: true, params: { threshold_pct: 80 }, schedule: "Weekly" });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ id: "job-1", params: { threshold_pct: 80 }, schedule: "Weekly" });
    expect((await run("job-1")).body).toMatchObject({ status: "ok", job_id: "job-1" });
    await saveJob({ id: "job-1", params: { threshold_pct: 10 } });
    expect((await run("job-1")).body.status).toBe("attention");
    expect((await api.call("DELETE", "/api/finops/jobs/job-1")).status).toBe(200);
    expect((await api.call("DELETE", "/api/finops/jobs/job-1")).status).toBe(404);
    expect((await run("job-1")).status).toBe(404);
  });

  it("validation", async () => {
    for (const job of [
      undefined,
      { name: "x" },
      { name: "x", kind: "bogus" },
      { kind: "dunning" },
      { name: "x", kind: "dunning", params: { nope: 1 } },
      { name: "x", kind: "po-approval", params: { threshold: -5 } },
      { name: "x", kind: "dunning", enabled: "yes" },
      { name: "x", kind: "dunning", schedule: "Hourly" },
      { id: "BAD ID", name: "x", kind: "dunning" },
      { id: "dunning", kind: "po-approval" },
    ]) expect((await saveJob(job)).status, JSON.stringify(job)).toBe(400);
    expect((await run("revenue-risk-alert")).status).toBe(409);
    expect((await run("dunning", { as_of: "2026-13-01" })).status).toBe(400);
  });

  it("dunning at the default date and at year end", async () => {
    expect((await run("dunning")).body).toMatchObject({ id: "RUN-0001", status: "ok", simulated: true, items: [] });
    const r = (await run("dunning", { as_of: "2026-12-31", operator: "pat" })).body;
    expect(r.status).toBe("attention");
    expect(r.items).toHaveLength(8);
    expect(r.items.reduce((s: number, i: any) => s + i.amount, 0)).toBe(43975);
    expect(r.items.filter((i: any) => i.label.endsWith("level 2"))).toHaveLength(4);
    const entries = listAudit(api.store, { source: "finance" });
    expect(entries.filter((e) => e.action === "dunning.reminder")).toHaveLength(8);
    expect(entries[0].actor).toBe("pat");
  });

  it("po approval flags the large POs; ledger check and month-end close", async () => {
    const po = (await run("po-approval")).body;
    expect(po.status).toBe("attention");
    expect(po.items.map((i: any) => [i.label, i.note])).toEqual([
      ["V-PO-5001", "needs approval"],
      ["V-PO-5002", "auto-approved"],
      ["V-PO-5003", "auto-approved"],
      ["V-PO-5004", "needs approval"],
    ]);
    expect((await run("gl-balance-check")).body).toMatchObject({ status: "ok", summary: "Ledger is balanced" });

    await api.call("PUT", "/api/finops/jobs", { job: { id: "month-end-close", enabled: true } });
    await api.call("POST", "/api/finops/audit/run", {});
    const blocked = (await run("month-end-close")).body;
    expect(blocked.status).toBe("attention");
    expect(blocked.items.filter((i: any) => i.note.startsWith("FAIL"))).toHaveLength(1);
    await api.call("PATCH", "/api/finops/audit/F-0001", { status: "resolved" });
    expect((await run("month-end-close")).body).toMatchObject({ status: "ok", summary: "Period close completed (simulated)" });
  });

  it("log lists runs newest first and filters by process", async () => {
    await run("dunning");
    await run("po-approval");
    const l = (await get("/api/finops/log?process=jobs")).entries;
    expect(l.map((e: any) => e.ref)).toEqual(["RUN-0002", "RUN-0001"]);
    expect(l[0].details).toMatchObject({ id: "RUN-0002", simulated: true });
    expect((await get("/api/finops/log?limit=1")).entries).toHaveLength(1);
    for (const q of ["?limit=0", "?limit=2000", "?process=bogus"]) expect((await api.call("GET", `/api/finops/log${q}`)).status, q).toBe(400);
    expect((await get("/api/finops/jobs")).jobs.find((j: any) => j.id === "dunning")).toMatchObject({ last_status: "ok" });
  });
});

describe("vendors, banks, history, browse (AC-FOP-004)", () => {
  it("vendors and bank accounts come from master data and the ledger", async () => {
    const v = (await get("/api/finops/vendors")).vendors;
    expect(v).toHaveLength(3);
    expect(v.find((x: any) => x.vendor_no === "V-100")).toMatchObject({ open_po_lines: 3, open_po_total: 687, mapped_account: null });
    expect((await get("/api/finops/bank-accounts")).accounts[0]).toMatchObject({ gl_account_no: "1000", balance: 219880 });
  });

  it("history by kind", async () => {
    const h = await get("/api/finops/history?kind=purchasing");
    expect(h.documents).toHaveLength(5);
    expect(h.documents.reduce((s: number, d: any) => s + d.amount, 0)).toBe(2997);
    expect((await api.call("GET", "/api/finops/history")).status).toBe(400);
    expect((await api.call("GET", "/api/finops/history?kind=zzz")).status).toBe(400);
  });

  it("virtual folders", async () => {
    const root = await get("/api/finops/browse");
    expect(root.entries.map((e: any) => e.name)).toEqual(["opening", "sales", "inventory", "purchasing", "expense", "manual"]);
    const sales = await get("/api/finops/browse?path=/sales");
    expect(sales.entries).toHaveLength(8);
    expect(sales.entries[0]).toMatchObject({ type: "file" });
    expect(await get("/api/finops/folder-status?path=/sales")).toMatchObject({ exists: true, files: 8, total_amount: 43975 });
    expect((await get("/api/finops/folder-status")).files).toBeGreaterThan(8);
    expect((await api.call("GET", "/api/finops/browse?path=/etc")).status).toBe(404);
    expect((await api.call("GET", "/api/finops/browse?path=../../secret")).status).toBe(404);
    expect((await api.call("GET", "/api/finops/folder-status?path=/nope")).status).toBe(404);
  });
});
