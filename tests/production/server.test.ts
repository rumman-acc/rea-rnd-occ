// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAudit } from "@/server/audit";
import { master } from "@/server/master";
import { installApi, type InstalledApi } from "../support/inprocess";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
});
afterEach(() => api.uninstall());

type R = { so_number: string };
type P = { po_number: string };
type W = { code: string };
const sim = (body: object) => api.call("POST", "/api/plan/simulate", { assembler_overrides: {}, overrides: [], new_orders: [], ...body });
const NEW = { name: "SIM-1", fg_item_no: "FG-3000", quantity: 1, so_number: "S-ORD101007", start_date: "2026-10-20", end_date: "2026-11-10" };

describe("production orders and linkage", () => {
  it("lists released orders with the fields the page reads", async () => {
    const r = await api.call("GET", "/api/production/orders");
    expect(r.body.map((o: P) => o.po_number)).toEqual(["P-ORD201001", "P-ORD201002", "P-ORD201004"]);
    expect(r.body[0]).toMatchObject({ pct_complete: 60, quantity: 4, health: "red", linked: true, delivery_date: "2026-10-22", model: "FG-1000", series: "1000" });
    expect(r.body[2].health).toBe("yellow");
  });

  it("linkage rows carry buffers and no-PO lines", async () => {
    const { rows, warnings } = (await api.call("GET", "/api/production/linkage")).body;
    expect(warnings).toEqual([]);
    expect(rows).toHaveLength(8);
    const by = Object.fromEntries(rows.map((r: R) => [r.so_number, r]));
    expect(by["S-ORD101001"]).toMatchObject({ prod_order_no: "P-ORD201001", buffer_days: -5, prod_pct_complete: 60 });
    expect(by["S-ORD101008"].buffer_days).toBe(2);
    expect(by["S-ORD101007"].prod_order_no).toBeNull();
    expect(by["S-ORD101004"].buffer_days).toBeNull();
  });

  it("release and finish transitions, 409s, 404 and audit", async () => {
    expect((await api.call("POST", "/api/production/orders/P-ORD201003/release")).body.status).toBe("Released");
    expect((await api.call("POST", "/api/production/orders/P-ORD201003/release")).status).toBe(409);
    expect((await api.call("POST", "/api/production/orders/P-ORD201002/finish")).body.status).toBe("Finished");
    expect((await api.call("POST", "/api/production/orders/P-ORD201005/finish")).status).toBe(409);
    expect((await api.call("POST", "/api/production/orders/NOPE/release")).status).toBe(404);
    expect((await api.call("POST", "/api/production/orders/P-ORD201001/bogus")).status).toBe(404);
    const orders = (await api.call("GET", "/api/production/orders")).body.map((o: P) => o.po_number);
    expect(orders).toEqual(["P-ORD201001", "P-ORD201003", "P-ORD201004"]);
    expect(listAudit(api.store, { source: "production" }).map((e) => e.action)).toEqual(["order.finish", "order.release"]);
  });

  it("creates, reschedules and sets progress with validation", async () => {
    const ok = { fg_item_no: "FG-3000", quantity: 1, start_date: "2026-10-20", end_date: "2026-11-10" };
    expect((await api.call("POST", "/api/production/orders", { ...ok, fg_item_no: "X" })).status).toBe(400);
    expect((await api.call("POST", "/api/production/orders", { ...ok, quantity: 0 })).status).toBe(400);
    expect((await api.call("POST", "/api/production/orders", { ...ok, end_date: "2026-10-01" })).status).toBe(400);
    expect((await api.call("POST", "/api/production/orders", { ...ok, so_number: "S-NOPE" })).status).toBe(400);
    const created = await api.call("POST", "/api/production/orders", { ...ok, so_number: "S-ORD101007" });
    expect(created.body).toMatchObject({ po_number: "P-ORD201007", status: "Planned" });
    const rs = await api.call("POST", "/api/production/orders/P-ORD201007/reschedule", { start_date: "2026-10-21", end_date: "2026-11-09" });
    expect(rs.body.end_date).toBe("2026-11-09");
    expect((await api.call("POST", "/api/production/orders/P-ORD201007/reschedule", { start_date: "2026-10-21" })).status).toBe(400);
    expect((await api.call("POST", "/api/production/orders/P-ORD201001/progress", { pct: 150 })).status).toBe(400);
    expect((await api.call("POST", "/api/production/orders/P-ORD201001/progress", { pct: 70 })).body.pct_complete).toBe(70);
    expect((await api.call("POST", "/api/production/orders/P-ORD201007/progress", { pct: 70 })).status).toBe(409);
    expect((await api.call("GET", "/api/plan")).body.kpis.linked_pct).toBe(88);
  });
});

describe("simulation (REQ-SIM)", () => {
  it("empty input equals the base plan and fills capacity rows", async () => {
    const base = (await api.call("GET", "/api/plan")).body;
    const s = (await sim({})).body;
    expect(s.kpis).toEqual(base.kpis);
    expect(s.status_board).toEqual(base.status_board);
    expect(s.capacity.length).toBe(36);
  });

  it("rescheduling a late order improves coverage without touching the store", async () => {
    const before = JSON.stringify(master(api.store, "production_orders"));
    const s = (await sim({ overrides: [{ po_number: "P-ORD201001", end_date: "2026-10-20" }] })).body;
    expect(s.kpis.on_time_pct).toBe(67);
    expect(s.status_board.find((r: R) => r.so_number === "S-ORD101001").health).not.toBe("red");
    expect((await api.call("GET", "/api/plan")).body.kpis.on_time_pct).toBe(50);
    expect(JSON.stringify(master(api.store, "production_orders"))).toBe(before);
    expect(listAudit(api.store, { source: "production" })).toHaveLength(0);
  });

  it("a simulated new order links an uncovered sales order; overrides can target it", async () => {
    const s = (await sim({ new_orders: [NEW] })).body;
    expect(s.kpis.linked_pct).toBe(88);
    expect(s.status_board.find((r: R) => r.so_number === "S-ORD101007").health).not.toBe("red");
    const late = (await sim({ new_orders: [NEW], overrides: [{ po_number: "SIM-1", end_date: "2026-11-30" }] })).body;
    expect(late.status_board.find((r: R) => r.so_number === "S-ORD101007").health).toBe("red");
  });

  it("validates input", async () => {
    expect((await sim({ overrides: [{ po_number: "NOPE", end_date: "2026-10-20" }] })).status).toBe(404);
    expect((await sim({ overrides: [{ po_number: "P-ORD201001", end_date: "20/10/2026" }] })).status).toBe(400);
    expect((await sim({ overrides: [{ po_number: "P-ORD201001", end_date: "2026-10-01" }] })).status).toBe(400);
    expect((await sim({ overrides: [{ po_number: "P-ORD201001" }] })).status).toBe(400);
    expect((await sim({ new_orders: [{ ...NEW, quantity: -1 }] })).status).toBe(400);
    expect((await sim({ new_orders: [{ ...NEW, name: "P-ORD201001" }] })).status).toBe(400);
    expect((await sim({ assembler_overrides: { "WC-ZZZ": 1 } })).status).toBe(404);
  });

  it("schedule and linkage views accept simulation input", async () => {
    const body = {
      overrides: [{ po_number: "P-ORD201001", start_date: "2026-10-13", end_date: "2026-10-20" }],
      new_orders: [{ ...NEW, name: "SIM-1", fg_item_no: "FG-6000", so_number: undefined }],
    };
    const sc = (await api.call("POST", "/api/production/schedule", body)).body;
    expect(sc.orders.find((o: P) => o.po_number === "P-ORD201001")).toMatchObject({ changed: true, simulated: false, end_date: "2026-10-20" });
    expect(sc.orders.find((o: P) => o.po_number === "SIM-1").simulated).toBe(true);
    expect((await api.call("GET", "/api/production/schedule")).body.unlinked_sos).toEqual(["S-ORD101007", "S-ORD101004"]);
    const lk = (await api.call("POST", "/api/production/linkage", body)).body;
    expect(lk.rows.find((r: R) => r.so_number === "S-ORD101001").buffer_days).toBe(2);
  });
});

describe("capacity", () => {
  it("week plan: 12 periods, assembly overloaded in week one", async () => {
    const p = (await api.call("GET", "/api/capacity/plan?granularity=week")).body;
    expect(p.periods).toHaveLength(12);
    expect(p.periods[0].start).toBe("2026-10-19");
    const asm = p.work_centers.find((w: W) => w.code === "WC-ASM");
    expect(asm.rows[0].status).toBe("over");
    expect(asm.rows[0].available_hours).toBe(80);
    expect(p.summary.overloaded).toBeGreaterThan(0);
    const m = (await api.call("GET", "/api/capacity/plan?granularity=month")).body;
    expect(m.periods).toHaveLength(6);
    expect(m.periods[0]).toMatchObject({ key: "2026-10", label: "Oct 26" });
    expect((await api.call("GET", "/api/capacity/plan?granularity=day")).status).toBe(400);
  });

  it("demand by order excludes finished orders", async () => {
    const d = (await api.call("GET", "/api/capacity/demand?granularity=week")).body;
    expect(d.orders.map((o: P) => o.po_number)).toContain("P-ORD201003");
    await api.call("POST", "/api/production/orders/P-ORD201002/finish");
    const d2 = (await api.call("GET", "/api/capacity/demand?granularity=week")).body;
    expect(d2.orders.map((o: P) => o.po_number)).not.toContain("P-ORD201002");
  });

  it("scenarios reduce or raise load and save nothing; what-if agrees", async () => {
    const r = (await api.call("POST", "/api/capacity/scenario", { granularity: "week", headcounts: { "WC-ASM": 4 } })).body;
    expect(r.delta.overloaded_after).toBeLessThan(r.delta.overloaded_before);
    expect((await api.call("GET", "/api/workcenters")).body.find((w: W) => w.code === "WC-ASM").headcount).toBe(2);
    const w = (await api.call("POST", "/api/capacity/what-if", { assembler_overrides: { "WC-ASM": 4 } })).body;
    expect(w.delta.overloaded_after).toBe(r.delta.overloaded_after);
    const shifted = (await api.call("POST", "/api/capacity/scenario", { po_shifts: { "P-ORD201003": 14 }, po_quantities: { "P-ORD201002": 2 }, po_dates: { "P-ORD201001": { end_date: "2026-10-28" } } })).body;
    expect(shifted.delta.peak_after).toBeLessThanOrEqual(shifted.delta.peak_before);
    const added = (await api.call("POST", "/api/capacity/scenario", { new_orders: [{ name: "X-1", fg_item_no: "FG-6000", quantity: 5, start_date: "2026-10-20", end_date: "2026-11-20" }] })).body;
    expect(added.delta.peak_after).toBeGreaterThan(added.delta.peak_before);
  });

  it("scenario validation", async () => {
    expect((await api.call("POST", "/api/capacity/scenario", { headcounts: { "WC-ZZZ": 1 } })).status).toBe(404);
    expect((await api.call("POST", "/api/capacity/scenario", { headcounts: { "WC-ASM": -1 } })).status).toBe(400);
    expect((await api.call("POST", "/api/capacity/scenario", { po_shifts: { NOPE: 1 } })).status).toBe(404);
    expect((await api.call("POST", "/api/capacity/scenario", { granularity: "year" })).status).toBe(400);
  });

  it("headcounts, routing times and adjustments persist and are audited", async () => {
    expect((await api.call("PUT", "/api/capacity/headcounts", { headcounts: { "WC-ASM": 5 } })).status).toBe(200);
    expect((await api.call("PUT", "/api/capacity/headcounts", { headcounts: { "WC-ASM": 5.5 } })).status).toBe(400);
    expect((await api.call("PUT", "/api/capacity/headcounts", { headcounts: { "WC-X": 1 } })).status).toBe(404);
    const asm = async () => (await api.call("GET", "/api/capacity/plan?granularity=week")).body.work_centers.find((w: W) => w.code === "WC-ASM");
    expect((await asm()).rows[0].available_hours).toBe(200);

    expect((await api.call("GET", "/api/capacity/routing-times")).body.models["FG-1000"]["WC-ASM"]).toBe(8);
    expect((await api.call("PUT", "/api/capacity/routing-times", { models: { "FG-1000": { "WC-ASM": 10 } } })).body.models["FG-1000"]["WC-ASM"]).toBe(10);
    expect((await api.call("PUT", "/api/capacity/routing-times", { models: { "FG-1000": { "WC-ASM": -1 } } })).status).toBe(400);
    expect((await api.call("PUT", "/api/capacity/routing-times", { models: { "FG-9": {} } })).status).toBe(400);

    const a = (await api.call("POST", "/api/capacity/adjustments", { work_center: "WC-ASM", start_date: "2026-10-19", end_date: "2026-10-23", hours_per_day: -8, reason: "training" })).body;
    expect(a.id).toBe(1);
    expect((await asm()).rows[0].available_hours).toBe(160);
    expect((await api.call("POST", "/api/capacity/adjustments", { work_center: "WC-ASM", start_date: "2026-10-19", end_date: "2026-10-18", hours_per_day: 1 })).status).toBe(400);
    expect((await api.call("DELETE", "/api/capacity/adjustments/99")).status).toBe(404);
    expect((await api.call("DELETE", "/api/capacity/adjustments/1")).body.ok).toBe(true);
    const actions = listAudit(api.store, { source: "production" }).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["headcounts.update", "routing.update", "adjustment.add", "adjustment.delete"]));
  });
});

describe("costing", () => {
  it("rolls up FG-1000 as specified", async () => {
    const c = (await api.call("GET", "/api/production/costing")).body;
    expect(c.overhead_pct).toBe(12);
    const fg = c.items.find((i: { item_no: string }) => i.item_no === "FG-1000");
    expect(fg).toMatchObject({ material_cost: 111.5, labor_cost: 396, overhead_cost: 47.52, total_cost: 555.02, sales_price: 685, margin: 129.98, margin_pct: 19 });
    expect(fg.components).toHaveLength(3);
    expect(fg.operations).toHaveLength(3);
  });

  it("labor rates and overhead change the roll-up; validation", async () => {
    expect((await api.call("PUT", "/api/capacity/labor-rates", { rates: { "WC-ASM": 34 }, overhead_pct: 10 })).status).toBe(200);
    const fg = (await api.call("GET", "/api/production/costing")).body.items.find((i: { item_no: string }) => i.item_no === "FG-1000");
    expect(fg.labor_cost).toBe(476); // 5*28 + 8*34 + 2*32
    expect(fg.overhead_cost).toBe(47.6);
    expect((await api.call("PUT", "/api/capacity/labor-rates", { rates: { "WC-ASM": -1 } })).status).toBe(400);
    expect((await api.call("PUT", "/api/capacity/labor-rates", { rates: { "WC-X": 1 } })).status).toBe(404);
    expect((await api.call("PUT", "/api/capacity/labor-rates", {})).status).toBe(400);
    expect(listAudit(api.store, { source: "production", q: "rates" })).toHaveLength(1);
  });
});
