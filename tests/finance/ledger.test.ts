// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAudit } from "@/server/audit";
import { updateMaster } from "@/server/master";
import { installApi, type InstalledApi } from "../support/inprocess";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
});
afterEach(() => api.uninstall());

const get = async (p: string) => (await api.call("GET", p)).body;
const tb = (from = "2026-01-01", to = "2026-12-31") => get(`/api/finance/trial-balance?date_from=${from}&date_to=${to}`);
const row = (t: { rows: { account_no: string }[] }, no: string) => t.rows.find((r) => r.account_no === no) as unknown as Record<string, number>;

describe("ledger tie-out (AC-FIN-001..004)", () => {
  it("trial balance debits equal credits and key accounts tie to master data", async () => {
    const t = await tb();
    expect(t.balanced).toBe(true);
    expect(t.totals.debit).toBe(t.totals.credit);
    expect(row(t, "1100").closing).toBe(43975);
    expect(row(t, "4000").credit).toBe(43975);
    expect(row(t, "5000").debit).toBe(5715);
    expect(row(t, "2000").credit).toBe(2997);
    expect(row(t, "1200").closing).toBe(2687);
    expect(row(t, "1000").closing).toBe(219880);
    expect(row(t, "3000").credit).toBe(255405);
  });

  it("trial balance carries an opening balance for a later period", async () => {
    const t = await tb("2026-10-01", "2026-10-31");
    expect(t.balanced).toBe(true);
    expect(row(t, "4000")).toMatchObject({ opening: -37350, credit: 6625, closing: -43975 });
  });

  it("income statement ties to the ledger", async () => {
    const s = await get("/api/finance/income-statement?year=2026&month=10");
    const sec = Object.fromEntries(s.sections.map((x: any) => [x.title, x]));
    expect(sec["Revenue"]).toMatchObject({ month_total: 6625, ytd_total: 43975 });
    expect(sec["Cost of goods sold"]).toMatchObject({ month_total: 687, ytd_total: 5715 });
    expect(sec["Operating expenses"]).toMatchObject({ month_total: 3120, ytd_total: 30120 });
    expect(s.net_income).toEqual({ month: 2818, ytd: 8140 });
    expect(s.unmapped_accounts).toEqual([]);
  });

  it("balance sheet balances and agrees with the trial balance and income statement", async () => {
    const b = await get("/api/finance/balance-sheet?as_of=2026-10-31");
    expect(b.balanced).toBe(true);
    expect(b.total_debit_side).toBe(266542);
    expect(b.total_credit_side).toBe(266542);
    expect(b.current_earnings).toBe(8140);
    const assets = b.sections.find((s: any) => s.title === "Assets");
    expect(assets.lines.find((l: any) => l.account_no === "1100").balance).toBe(43975);
    // earlier date: nothing posted yet except opening and rent
    const early = await get("/api/finance/balance-sheet?as_of=2026-01-31");
    expect(early.balanced).toBe(true);
    expect(early.current_earnings).toBe(-3000);
  });

  it("every document is balanced and can be drilled into", async () => {
    const d = await get("/api/finance/gl/document/INV-S-ORD101001-10");
    expect(d).toMatchObject({ source: "sales", total_debit: 6850, total_credit: 6850, balanced: true });
    expect(d.lines).toHaveLength(2);
    expect((await api.call("GET", "/api/finance/gl/document/NOPE")).status).toBe(404);
    const all = await get("/api/finance/gl?limit=1000");
    const docs = new Set(all.lines.map((l: any) => l.document_no));
    for (const no of docs) expect((await get(`/api/finance/gl/document/${no}`)).balanced).toBe(true);
  });

  it("validates report parameters", async () => {
    for (const p of [
      "/api/finance/trial-balance",
      "/api/finance/trial-balance?date_from=2026-02-30&date_to=2026-03-01",
      "/api/finance/trial-balance?date_from=2026-05-01&date_to=2026-04-01",
      "/api/finance/income-statement?year=2026&month=13",
      "/api/finance/income-statement?year=2026",
      "/api/finance/balance-sheet",
      "/api/finance/balance-sheet?as_of=bad",
    ]) {
      const r = await api.call("GET", p);
      expect(r.status, p).toBe(400);
      expect(r.body.detail).toBeTruthy();
    }
  });
});

describe("GL browser (AC-FIN-005)", () => {
  it("filters, pages and facets", async () => {
    const ar = await get("/api/finance/gl?account_no=1100");
    expect(ar.total).toBe(8);
    expect(ar.totals).toEqual({ debit: 43975, credit: 0 });
    expect((await get("/api/finance/gl?source=purchasing")).total).toBe(10);
    expect((await get("/api/finance/gl?q=freight")).total).toBe(2);
    expect((await get("/api/finance/gl?date_from=2026-10-01&date_to=2026-10-03")).lines.every((l: any) => l.posting_date <= "2026-10-03")).toBe(true);
    const page = await get("/api/finance/gl?limit=5&offset=5");
    expect(page.lines).toHaveLength(5);
    expect(page.total).toBeGreaterThan(5);
    const f = await get("/api/finance/gl/facets");
    expect(f.accounts.find((a: any) => a.account_no === "1100")).toMatchObject({ name: "Accounts Receivable", count: 8 });
    expect(f.sources.map((s: any) => s.source)).toContain("manual");
    expect(f.years).toEqual([2026]);
    for (const p of ["?source=bogus", "?limit=0", "?offset=-1", "?date_from=x"]) expect((await api.call("GET", `/api/finance/gl${p}`)).status, p).toBe(400);
  });
});

describe("sync (simulated connector)", () => {
  it("reports status, tops up incrementally and rebuilds fully", async () => {
    const s0 = await get("/api/finance/sync/status");
    expect(s0).toMatchObject({ simulated: true, last_sync_at: null, status: "idle" });
    const before = s0.lines;
    expect((await api.call("POST", "/api/finance/sync", {})).body.added_lines).toBe(0);

    updateMaster(api.store, "sales_lines", (l) => {
      l.push({ so_number: "S-ORD999", line_no: "90", customer_id: "C-01", fg_item_no: "FG-1000", quantity: 2, unit_price: 700, order_date: "2026-10-10", delivery_date: "2026-11-10" });
    });
    const inc = (await api.call("POST", "/api/finance/sync", { full: false })).body;
    expect(inc).toMatchObject({ added_lines: 4, last_mode: "incremental", lines: before + 4 });
    expect((await tb()).balanced).toBe(true);
    expect(row(await tb(), "1100").closing).toBe(43975 + 1400);

    const full = (await api.call("POST", "/api/finance/sync", { full: true })).body;
    expect(full).toMatchObject({ last_mode: "full", lines: before + 4 });
    expect(listAudit(api.store, { source: "finance" }).filter((e) => e.action === "gl.sync")).toHaveLength(3);
    expect((await api.call("POST", "/api/finance/sync", { full: "yes" })).status).toBe(400);
  });

  it("mappings change what a full sync posts", async () => {
    const m = await api.call("PUT", "/api/finops/mappings", { operator: "pat", kind: "series-account", key: "3000", value: "4100" });
    expect(m.body).toMatchObject({ id: "M-0001", value: "4100", updated_by: "pat" });
    await api.call("POST", "/api/finance/sync", { full: true });
    let t = await tb();
    expect(row(t, "4100").credit).toBe(9600);
    expect(row(t, "4000").credit).toBe(34375);
    expect(t.balanced).toBe(true);
    expect((await api.call("DELETE", "/api/finops/mappings/M-0001")).status).toBe(200);
    expect((await api.call("DELETE", "/api/finops/mappings/M-0001")).status).toBe(404);
    await api.call("POST", "/api/finance/sync", { full: true });
    t = await tb();
    expect(row(t, "4000").credit).toBe(43975);
  });
});

describe("layouts and budget (AC-FIN-006)", () => {
  it("serves default layouts and applies a saved one", async () => {
    const l = await get("/api/finance/layout/income-statement");
    expect(l.layout.sections).toHaveLength(3);
    const edited = { sections: [{ title: "Revenue", normal: "credit", accounts: ["4000", "4100"] }, { title: "Costs", normal: "debit", accounts: ["5000", "6000"] }] };
    const r = await api.call("PUT", "/api/finance/layout/income-statement", { layout: edited, actor: "pat" });
    expect(r.body).toMatchObject({ updated_by: "pat" });
    const s = await get("/api/finance/income-statement?year=2026&month=10");
    expect(s.unmapped_accounts).toEqual(["6100"]);
    expect(s.net_income.ytd).toBe(8260);
    expect((await api.call("GET", "/api/finance/layout/nope")).status).toBe(404);
    const bad = [
      { sections: [] },
      { sections: [{ title: "x", normal: "up", accounts: [] }] },
      { sections: [{ title: "x", normal: "debit", accounts: ["9999"] }] },
      { sections: [{ title: "a", normal: "debit", accounts: ["5000"] }, { title: "b", normal: "debit", accounts: ["5000"] }] },
    ];
    for (const layout of bad) expect((await api.call("PUT", "/api/finance/layout/income-statement", { layout })).status).toBe(400);
  });

  it("a layout that omits an account is reported, not hidden, on the balance sheet", async () => {
    const layout = { sections: [{ title: "Assets", normal: "debit", accounts: ["1000", "1100"] }, { title: "Equity", normal: "credit", accounts: ["3000"] }] };
    await api.call("PUT", "/api/finance/layout/balance-sheet", { layout });
    const b = await get("/api/finance/balance-sheet?as_of=2026-10-31");
    expect(b.balanced).toBe(false);
    expect(b.unmapped_accounts).toEqual(["1200", "2000"]);
  });

  it("budget: seed, read, replace, validate, compare in the dashboard", async () => {
    expect((await get("/api/finance/budget?year=2026")).entries).toEqual([]);
    const seeded = (await api.call("POST", "/api/finance/budget/seed", { year: 2027, source_year: 2026, factor: 1.1 })).body;
    expect(seeded.total_revenue).toBe(48372.5);
    expect(seeded.total_expenses).toBe(39418.5);
    expect((await get("/api/finance/budget?year=2027")).entries.length).toBe(seeded.entries.length);

    const put = await api.call("PUT", "/api/finance/budget", { year: 2026, entries: [{ account_no: "4000", month: 10, amount: 6000 }, { account_no: "5000", month: 10, amount: 500 }] });
    expect(put.body).toMatchObject({ total_revenue: 6000, total_expenses: 500 });
    const d = await get("/api/finance/dashboard?year=2026&month=10");
    expect(d.budget).toMatchObject({ has_budget: true, revenue: { actual: 6625, budget: 6000, variance: 625 } });

    for (const body of [
      { year: 2026, entries: [{ account_no: "1000", month: 1, amount: 1 }] },
      { year: 2026, entries: [{ account_no: "4000", month: 13, amount: 1 }] },
      { year: 2026, entries: [{ account_no: "4000", month: 1, amount: -1 }] },
      { year: 2026, entries: [{ account_no: "4000", month: 1, amount: 1 }, { account_no: "4000", month: 1, amount: 2 }] },
      { year: 1999, entries: [] },
      { year: 2026 },
    ]) expect((await api.call("PUT", "/api/finance/budget", body)).status).toBe(400);
    for (const body of [{ year: 2027, source_year: 2026, factor: 0 }, { year: 2027, source_year: 2020, factor: 1 }, { year: 2027, source_year: 2026 }]) {
      expect((await api.call("POST", "/api/finance/budget/seed", body)).status).toBe(400);
    }
    expect((await api.call("GET", "/api/finance/budget")).status).toBe(400);
  });
});

describe("dashboard (AC-FIN-007)", () => {
  it("combines ledger KPIs with the operational views", async () => {
    const d = await get("/api/finance/dashboard");
    expect(d).toMatchObject({ year: 2026, month: 10, as_of: "2026-10-19" });
    expect(d.gl).toMatchObject({ revenue_month: 6625, revenue_ytd: 43975, net_income_ytd: 8140, cash: 219880, receivables: 43975, inventory: 2687, payables: 2997, trial_balance_balanced: true });
    expect(d.months).toHaveLength(12);
    expect(d.months[8]).toMatchObject({ month: 9, revenue: 37350 });
    expect(d.operational.receivables.total).toBe(43975);
    expect(d.operational.payables.total).toBe(2997);
    expect(d.operational.risk.total).toBeCloseTo((await get("/api/plan")).kpis.revenue_at_risk, 2);
    expect(d.operational.cash.opening).toBe(219880);
    const dec = await get("/api/finance/dashboard?year=2026&month=12");
    expect(dec.as_of).toBe("2026-12-31");
    expect(dec.operational.kpis.overdue_receivables).toBe(43975);
    for (const q of ["?year=2026", "?month=13&year=2026", "?year=x&month=1"]) expect((await api.call("GET", `/api/finance/dashboard${q}`)).status, q).toBe(400);
  });

  it("margin by series follows the BOM roll-up", async () => {
    const m = (await get("/api/finance/dashboard")).operational.margin;
    expect(m.series[0]).toMatchObject({ series: "1000", revenue: 15755, cost: 2564.5, margin_pct: 83.7 });
    expect(m.total).toMatchObject({ revenue: 43975, margin: 38260, margin_pct: 87 });
  });
});
