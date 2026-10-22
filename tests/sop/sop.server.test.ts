// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAudit } from "@/server/audit";
import { installApi, type InstalledApi } from "../support/inprocess";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
});
afterEach(() => api.uninstall());

const sop = async () => (await api.call("GET", "/api/sop")).body;
const row = (b: any, model: string) => b.rows.find((r: any) => r.model === model);

describe("GET /api/sop (seeded, clock 2026-10-19)", () => {
  it("has a 6-month window starting this month", async () => {
    const b = await sop();
    expect(b.months).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
    expect(b.rows.map((r: any) => r.model)).toEqual(["1000 STD", "2000 STD", "3000 STD", "6000 STD"]);
  });

  it("derives demand and scheduled supply from sales lines and production orders", async () => {
    const b = await sop();
    const r1 = row(b, "1000 STD");
    expect(r1.cells.map((c: any) => c.demand)).toEqual([23, 0, 0, 0, 0, 0]);
    expect(r1.cells.map((c: any) => c.scheduled)).toEqual([15, 8, 0, 0, 0, 0]);
    expect(r1.cells.map((c: any) => c.gap)).toEqual([-8, 8, 0, 0, 0, 0]);
    expect(row(b, "2000 STD").cells.map((c: any) => c.gap)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(row(b, "6000 STD").cells[1]).toMatchObject({ demand: 1, scheduled: 0, gap: -1 });
    expect(r1.items[0].item_no).toBe("FG-1000");
    expect(r1.series).toBe("1000");
  });

  it("insights are rule-based text", async () => {
    const b = await sop();
    expect(b.insights[0]).toBe("6-month demand 45 units vs plan 43 units (96% covered).");
    expect(b.insights.filter((t: string) => t.includes("shortfall"))).toHaveLength(3);
    expect(b.insights[1]).toContain("Model 1000 STD: shortfall of 8 units across 1 month, first in Oct 26");
  });
});

describe("PUT /api/sop/plan", () => {
  it("saves firm/flex, closes gaps, and audits", async () => {
    const r = await api.call("PUT", "/api/sop/plan", { entries: { "1000 STD_2026-10": { firm: 8 }, "3000 STD_2026-11": { flex: 1 } } });
    expect(r.body).toEqual({ saved: 2 });
    const b = await sop();
    expect(row(b, "1000 STD").cells[0]).toMatchObject({ firm: 8, effective_supply: 23, gap: 0 });
    expect(b.insights.filter((t: string) => t.includes("shortfall"))).toHaveLength(1);
    expect(listAudit(api.store, { source: "sop" })[0].action).toBe("sop.plan.save");
  });

  it("merges layers, and clears with null or zero", async () => {
    await api.call("PUT", "/api/sop/plan", { entries: { "1000 STD_2026-11": { firm: 5 } } });
    await api.call("PUT", "/api/sop/plan", { entries: { "1000 STD_2026-11": { flex: 2 } } });
    expect(row(await sop(), "1000 STD").cells[1]).toMatchObject({ firm: 5, flex: 2 });
    await api.call("PUT", "/api/sop/plan", { entries: { "1000 STD_2026-11": { firm: 0, flex: 0 } } });
    expect(row(await sop(), "1000 STD").cells[1]).toMatchObject({ firm: 0, flex: 0 });
    await api.call("PUT", "/api/sop/plan", { entries: { "1000 STD_2026-11": { firm: 3 } } });
    await api.call("PUT", "/api/sop/plan", { entries: { "1000 STD_2026-11": null } });
    expect(row(await sop(), "1000 STD").cells[1].firm).toBe(0);
  });

  it("stores item-level plans separately from the model row and reports surplus", async () => {
    await api.call("PUT", "/api/sop/plan", { entries: { "2000 STD|FG-2000_2026-12": { firm: 4 }, "2000 STD_2026-12": { firm: 10 } } });
    const r = row(await sop(), "2000 STD");
    expect(r.items[0].cells[2].firm).toBe(4);
    expect(r.cells[2].firm).toBe(10);
    expect((await sop()).insights.some((t: string) => t.includes("Model 2000 STD: surplus of 10 units"))).toBe(true);
  });

  it("adds plan-only models derived from the key", async () => {
    await api.call("PUT", "/api/sop/plan", { entries: { "5000 1H_2026-10": { firm: 2 } } });
    const r = row(await sop(), "5000 1H");
    expect(r.series).toBe("5000");
    expect(r.cells[0].effective_supply).toBe(2);
  });

  it("validates input", async () => {
    const bad = async (entries: unknown) => (await api.call("PUT", "/api/sop/plan", { entries })).status;
    expect(await bad(undefined)).toBe(400);
    expect(await bad([])).toBe(400);
    expect(await bad({ nonsense: { firm: 1 } })).toBe(400);
    expect(await bad({ "1000 STD_2026-10": { firm: -1 } })).toBe(400);
    expect(await bad({ "1000 STD_2026-10": { firm: "x" } })).toBe(400);
    expect(await bad({ "1000 STD_2026-10": {} })).toBe(400);
    expect(await bad({ "1000 STD_2026-10": 5 })).toBe(400);
    expect(await bad({ "1000 STD_2025-01": { firm: 1 } })).toBe(400);
    expect(await bad({ "1000 STD|NOPE_2026-10": { firm: 1 } })).toBe(400);
    const r = await api.call("PUT", "/api/sop/plan", { entries: { "1000 STD_2026-10": { firm: -1 } } });
    expect(r.body.detail).toMatch(/firm/);
    expect(row(await sop(), "1000 STD").cells[0].firm).toBe(0);
  });
});
