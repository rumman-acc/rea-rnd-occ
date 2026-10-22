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

const comp = (d: any, item: string) => d.components.find((c: any) => c.item_no === item);

describe("catalog and statuses", () => {
  it("AC-SUP-1 lists finished goods with demand source", async () => {
    const r = await api.call("GET", "/api/fgs");
    expect(r.status).toBe(200);
    expect(r.body.map((f: any) => [f.item_no, f.demand_source])).toEqual([
      ["FG-1000", "orders"], ["FG-2000", "orders"], ["FG-3000", "orders"], ["FG-6000", "both"],
    ]);
  });

  it("marks an FG without demand as none", async () => {
    updateMaster(api.store, "sales_lines", (l) => l.splice(0, l.length, ...l.filter((x) => x.fg_item_no !== "FG-3000")));
    const r = await api.call("GET", "/api/fgs");
    expect(r.body.find((f: any) => f.item_no === "FG-3000").demand_source).toBe("none");
    const s = await api.call("GET", "/api/supply-status");
    expect(s.body["FG-3000"]).toBeUndefined();
  });

  it("AC-SUP-2 supply status per FG", async () => {
    const r = await api.call("GET", "/api/supply-status");
    expect(r.body).toEqual({ "FG-1000": "red", "FG-2000": "yellow", "FG-3000": "red", "FG-6000": "green" });
  });
});

describe("supply detail", () => {
  it("AC-SUP-3 nets FG-1000 through the BOM", async () => {
    const { status, body: d } = await api.call("GET", "/api/supply-detail/FG-1000");
    expect(status).toBe(200);
    expect(d.total_demand).toBe(23);
    expect(d.overall).toBe("red");
    expect(d.customers).toEqual(["Northwind Water Utilities", "Meridian Oil & Gas", "Ridgeline Mining"]);
    const a = comp(d, "CMP-A");
    expect(a).toMatchObject({ required: 46, on_hand: 20, reserved: 4, on_po: 15, net_available: -15, status: "red", po_eta: "2026-10-20", vendor_no: "V-100" });
    expect(a.open_pos).toHaveLength(2);
    expect(comp(d, "CMP-B")).toMatchObject({ required: 23, net_available: 47, status: "green" });
    expect(comp(d, "CMP-C")).toMatchObject({ required: 23, net_available: -9, status: "red" });
    expect(d.vendor_summary.map((v: any) => v.vendor_no)).toEqual(["V-100"]);
    expect(d.vendor_summary[0].parts).toEqual(["CMP-A", "CMP-C"]);
  });

  it("yellow when covered only by open POs", async () => {
    const { body: d } = await api.call("GET", "/api/supply-detail/FG-2000");
    expect(comp(d, "CMP-D")).toMatchObject({ required: 36, net_available: 24, status: "yellow" });
    expect(d.overall).toBe("yellow");
  });

  it("AC-SUP-4 nests sub-assembly components and adds planned demand", async () => {
    const { body: d } = await api.call("GET", "/api/supply-detail/FG-6000");
    expect(d.bc_demand).toBe(1);
    expect(d.planned_demand).toBe(1);
    expect(d.total_demand).toBe(2);
    const sub = d.components.find((c: any) => c.is_subassembly);
    expect(sub).toMatchObject({ item_no: "SUB-6100", level: 1 });
    expect(comp(d, "CMP-F")).toMatchObject({ level: 2, required: 8, qty_per_unit: 4 });
    expect(d.sales_orders.filter((s: any) => s.is_planned)).toHaveLength(1);
  });

  it("404 for an unknown FG", async () => {
    const r = await api.call("GET", "/api/supply-detail/NOPE");
    expect(r.status).toBe(404);
    expect(r.body.detail).toMatch(/NOPE/);
  });

  it("reliability from history, open lines, and n/a", async () => {
    const { body: d } = await api.call("GET", "/api/supply-detail/FG-1000");
    expect(d.vendor_summary[0]).toMatchObject({ reliability_pct: 50, avg_overdue_days: 4.5 });
    expect(d.vendor_summary[0].reliability_source).toMatch(/^history/);
    // V-300 has no history: falls back to open lines
    const { body: e } = await api.call("GET", "/api/supply-detail/FG-6000");
    expect(e.vendor_summary).toEqual([]);
    // unassigned vendor => n/a
    updateMaster(api.store, "components", (cs) => {
      cs.find((c) => c.item_no === "CMP-E")!.vendor_id = "";
    });
    const { body: f } = await api.call("GET", "/api/supply-detail/FG-3000");
    const un = f.vendor_summary.find((v: any) => v.vendor_no === "UNASSIGNED");
    expect(un.reliability_pct).toBeNull();
  });

  it("open-line reliability when a vendor has no history", async () => {
    updateMaster(api.store, "components", (cs) => {
      cs.find((c) => c.item_no === "CMP-F")!.on_hand = 0;
    });
    const { body: d } = await api.call("GET", "/api/supply-detail/FG-6000");
    const v = d.vendor_summary.find((x: any) => x.vendor_no === "V-300");
    expect(v.reliability_source).toBe("open lines");
    expect(v.reliability_pct).toBe(100);
  });
});

describe("netting projections", () => {
  it("AC-SUP-5 stockouts and recommended POs", async () => {
    const { body: n } = await api.call("GET", "/api/supply-netting");
    expect(n.orders.map((o: any) => o.so_number)[0]).toBe("PLAN-FG-6000-2026-12");
    expect(n.orders.find((o: any) => o.so_number === "S-ORD101004").bom.map((b: any) => b.item_no)).toEqual(["CMP-A", "SUB-6100", "CMP-F"]);
    const e = n.projections_without["CMP-E"];
    expect(e.first_stockout_date).toBe("2026-11-05");
    expect(e.min_balance).toBe(-3);
    expect(e.events.some((x: any) => x.kind === "recommended_po")).toBe(false);
    const eWith = n.projections_with["CMP-E"];
    const rec = eWith.events.find((x: any) => x.kind === "recommended_po");
    expect(rec.delta).toBe(5);
    expect(rec.on_date).toBe("2026-11-16");
    expect(n.projections_with["CMP-A"].events.some((x: any) => x.kind === "recommended_po")).toBe(true);
    expect(n.projections_without["CMP-A"].events.some((x: any) => x.kind === "recommended_po")).toBe(false);
    expect(n.projections_without["CMP-B"].first_stockout_date).toBeNull();
  });
});

describe("push purchase order", () => {
  const body = { vendor_no: "V-100", operator: "x", lines: [{ item_no: "CMP-A", quantity: 20, required_date: "2026-11-01" }] };

  it("AC-SUP-6 creates a draft PO that raises supply and is audited", async () => {
    const r = await api.call("POST", "/api/replenishment/push", body);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ bc_po_number: "V-PO-D9001", vendor_name: "Apex Components", amount: 840, delivery_date: "2026-11-01" });
    const d = (await api.call("GET", "/api/supply-detail/FG-1000")).body;
    expect(comp(d, "CMP-A").on_po).toBe(35);
    expect(listAudit(api.store, { source: "supply" })).toHaveLength(1);
    const r2 = await api.call("POST", "/api/replenishment/push", body);
    expect(r2.body.bc_po_number).toBe("V-PO-D9002");
  });

  it.each([
    [{ ...body, vendor_no: "ZZ" }, /vendor/i],
    [{ ...body, lines: [] }, /line/i],
    [{ ...body, lines: [{ item_no: "NOPE", quantity: 1, required_date: "2026-11-01" }] }, /item/i],
    [{ ...body, lines: [{ item_no: "CMP-A", quantity: 0, required_date: "2026-11-01" }] }, /quantity/i],
    [{ ...body, lines: [{ item_no: "CMP-A", quantity: 1, required_date: "2026-02-31" }] }, /required_date/],
    [{ ...body, lines: [{ item_no: "CMP-A", quantity: 1, required_date: "2026-11-01", unit_price: -1 }] }, /unit_price/],
  ])("400 on invalid input %#", async (b, re) => {
    const r = await api.call("POST", "/api/replenishment/push", b);
    expect(r.status).toBe(400);
    expect(r.body.detail).toMatch(re);
    expect(listAudit(api.store, { source: "supply" })).toHaveLength(0);
  });
});
