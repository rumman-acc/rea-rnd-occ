// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installApi, type InstalledApi } from "../support/inprocess";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
});
afterEach(() => api.uninstall());

const recs = async () => (await api.call("GET", "/api/cockpit/recommendations")).body;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const line = (body: { lines: { item_no: string }[] }, item: string) => body.lines.find((l) => l.item_no === item) as any;

describe("recommendations (AC-PUR-1)", () => {
  it("lists the red and yellow components with rule-based suggestions", async () => {
    const r = await recs();
    expect(r.engine).toBe("rule-based");
    expect(r.lines.map((l: any) => [l.item_no, l.supply_status])).toEqual([["CMP-A", "red"], ["CMP-C", "red"], ["CMP-E", "red"], ["CMP-D", "yellow"]]);
    const e = line(r, "CMP-E");
    expect(e.vendor_no).toBe("V-200");
    expect(e.suggested.qty).toBe(5);
    expect(e.suggested.price).toBe(116.4);
    expect(e.lead_time_days).toBe(28);
    expect(e.suggested.preselect).toBe(false);
    const a = line(r, "CMP-A");
    expect(a.suggested.qty).toBe(15);
    expect(a.suggested.price).toBe(40.74);
    expect(a.suggested.expedite).toBe(true);
    expect(a.demand_detail.map((d: any) => d.fg_item_no).sort()).toEqual(["FG-1000", "FG-6000"]);
    const d = line(r, "CMP-D");
    expect(d.engine_qty).toBe(0);
    expect(d.open_pos).toHaveLength(1);
    expect(d.rationale).toContain("not an AI model");
  });

  it("accepts refresh=true", async () => {
    expect((await api.call("GET", "/api/cockpit/recommendations?refresh=true")).status).toBe(200);
  });
});

describe("persona (AC-PUR-2)", () => {
  it("has defaults, validates and persists", async () => {
    expect((await api.call("GET", "/api/cockpit/persona")).body).toMatchObject({ risk_posture: "balanced", delivery_padding_days: 3, horizon: "auto", respect_moq: true });
    expect((await api.call("PUT", "/api/cockpit/persona", { delivery_padding_days: 31 })).status).toBe(400);
    expect((await api.call("PUT", "/api/cockpit/persona", { delivery_padding_days: 2.5 })).status).toBe(400);
    expect((await api.call("PUT", "/api/cockpit/persona", { horizon: "decade" })).status).toBe(400);
    expect((await api.call("PUT", "/api/cockpit/persona", { risk_posture: "wild" })).status).toBe(400);
    expect((await api.call("PUT", "/api/cockpit/persona", { respect_moq: "yes" })).status).toBe(400);
    const ok = await api.call("PUT", "/api/cockpit/persona", { delivery_padding_days: 10 });
    expect(ok.status).toBe(200);
    expect((await api.call("GET", "/api/cockpit/persona")).body.delivery_padding_days).toBe(10);
    const audit = (await api.call("GET", "/api/admin/audit?source=purchasing&q=")).body;
    expect(JSON.stringify(audit)).toContain("persona");
  });

  it("posture and MOQ change the suggested quantity", async () => {
    const base = line(await recs(), "CMP-A").suggested.qty;
    await api.call("PUT", "/api/cockpit/persona", { risk_posture: "covered" });
    const covered = line(await recs(), "CMP-A").suggested.qty;
    expect(covered).toBeGreaterThan(base);
    await api.call("PUT", "/api/cockpit/persona", { risk_posture: "lean", respect_moq: false });
    expect(line(await recs(), "CMP-C").suggested.qty).toBe(9);
    expect(line(await recs(), "CMP-E").suggested.qty).toBe(3);
  });
});

describe("buy recommendation (AC-PUR-3)", () => {
  it("resolves horizons, validates and returns the modal fields", async () => {
    const r = (await api.call("GET", "/api/buy-recommendation/CMP-A?horizon=3m")).body;
    expect(r).toMatchObject({ recommended_qty: 20, horizon: "3m", lead_time_days: 14, vendor_delay_days: 5, effective_lead_days: 19, reliability_pct: 50 });
    expect(r.eta >= "2026-11-07").toBe(true);
    for (const k of ["eta", "unit_cost", "rationale", "expedite", "order_by"]) expect(r).toHaveProperty(k);
    expect((await api.call("GET", "/api/buy-recommendation/CMP-A?horizon=auto")).body.horizon).toBe("urgent");
    expect((await api.call("GET", "/api/buy-recommendation/CMP-A")).status).toBe(200);
    expect((await api.call("GET", "/api/buy-recommendation/CMP-A?horizon=bogus")).status).toBe(400);
    expect((await api.call("GET", "/api/buy-recommendation/FG-1000")).status).toBe(404);
    expect((await api.call("GET", "/api/buy-recommendation/CMP-D?horizon=1m")).body.recommended_qty).toBe(0);
  });
});

describe("posting POs (AC-PUR-4, AC-PUR-5)", () => {
  it("recommendation -> post -> open POs, history, plan, netting, audit", async () => {
    const before = (await api.call("GET", "/api/plan")).body.kpis;
    expect(before.critical_items).toBe(3);
    const e = line(await recs(), "CMP-E");
    const res = await api.call("POST", "/api/cockpit/post-pos", {
      operator: "buyer1",
      lines: [{ item_no: "CMP-E", vendor_no: e.vendor_no, vendor_name: e.vendor_name, qty: e.suggested.qty, price: e.suggested.price, delivery_date: e.suggested.delivery_date }],
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ status: "created", po_number: "V-PO-B1001", vendor_no: "V-200", amount: 582 });

    const open = (await api.call("GET", "/api/cockpit/open-pos")).body;
    expect(open.find((p: any) => p.po_number === "V-PO-B1001")).toMatchObject({ status: "Open", amount: 582, qty_ordered: 5, qty_received: 0, vendor_name: "Brightline Supply" });
    expect(open.filter((p: any) => p.status === "Released").map((p: any) => p.po_number).sort()).toEqual(["V-PO-5001", "V-PO-5002", "V-PO-5003", "V-PO-5004"]);

    const hist = (await api.call("GET", "/api/cockpit/po-history")).body;
    expect(hist[0]).toMatchObject({ po_number: "V-PO-B1001", operator: "buyer1", status: "created" });

    const after = (await api.call("GET", "/api/plan")).body.kpis;
    expect(after.critical_items).toBe(2);
    expect(after.expedite_lines).toBe(before.expedite_lines);

    const net = (await api.call("GET", "/api/supply-netting")).body;
    expect(net.projections_without["CMP-E"].events.some((x: any) => x.kind === "po" && x.delta === 5)).toBe(true);

    // covered by the new PO: no further buy, but the line stays (yellow) until stock is on hand
    expect(line(await recs(), "CMP-E")).toMatchObject({ supply_status: "yellow", engine_qty: 0 });
    const audit = (await api.call("GET", "/api/admin/audit?source=purchasing&q=")).body;
    expect(JSON.stringify(audit)).toContain("buyer1");
  });

  it("groups lines per vendor and numbers sequentially", async () => {
    const res = await api.call("POST", "/api/cockpit/post-pos", {
      operator: "b",
      lines: [
        { item_no: "CMP-A", vendor_no: "V-100", qty: 20, price: null, delivery_date: "2026-11-10" },
        { item_no: "CMP-C", vendor_no: "V-100", qty: 12, price: 9, delivery_date: "2026-11-08" },
        { item_no: "CMP-E", vendor_no: "V-200", qty: 5, price: null, delivery_date: "2026-11-16" },
      ],
    });
    expect(res.body.map((r: any) => [r.po_number, r.vendor_no, r.lines.length, r.delivery_date])).toEqual([
      ["V-PO-B1001", "V-100", 2, "2026-11-08"],
      ["V-PO-B1002", "V-200", 1, "2026-11-16"],
    ]);
    // a null price falls back to the purchase book (97% of unit cost for the vendor)
    expect(res.body[0].lines[0].price).toBe(40.74);
    expect(res.body[0].amount).toBeCloseTo(20 * 40.74 + 12 * 9, 2);
    const more = await api.call("POST", "/api/cockpit/post-pos", { lines: [{ item_no: "CMP-B", vendor_no: "V-200", qty: 1, price: 1, delivery_date: "2026-11-10" }] });
    expect(more.body[0].po_number).toBe("V-PO-B1003");
  });

  it("rejects bad input without writing anything", async () => {
    const good = { item_no: "CMP-E", vendor_no: "V-200", qty: 5, price: 1, delivery_date: "2026-11-16" };
    for (const bad of [
      [],
      [{ ...good, qty: 0 }],
      [{ ...good, qty: "5" }],
      [{ ...good, item_no: "NOPE" }],
      [{ ...good, delivery_date: "2026-13-40" }],
      [{ ...good, price: -1 }],
      [good, { ...good, qty: -2 }],
    ]) {
      expect((await api.call("POST", "/api/cockpit/post-pos", { operator: "x", lines: bad })).status).toBe(400);
    }
    expect((await api.call("POST", "/api/cockpit/post-pos", {})).status).toBe(400);
    expect((await api.call("GET", "/api/cockpit/po-history")).body).toEqual([]);
    expect((await api.call("GET", "/api/cockpit/open-pos")).body).toHaveLength(4);
  });

  it("an unknown or missing vendor fails that PO only", async () => {
    const res = await api.call("POST", "/api/cockpit/post-pos", {
      operator: "b",
      lines: [
        { item_no: "CMP-E", vendor_no: "V-200", qty: 5, price: 1, delivery_date: "2026-11-16" },
        { item_no: "CMP-F", vendor_no: "UNASSIGNED", qty: 2, price: 1, delivery_date: "2026-11-16" },
        { item_no: "CMP-F", vendor_no: "V-999", qty: 2, price: 1, delivery_date: "2026-11-16" },
      ],
    });
    expect(res.body.map((r: any) => r.status).sort()).toEqual(["created", "failed", "failed"]);
    const hist = (await api.call("GET", "/api/cockpit/po-history")).body;
    expect(hist.filter((h: any) => h.status === "failed")).toHaveLength(2);
    expect(hist.find((h: any) => h.status === "failed").error).toBeTruthy();
    expect((await api.call("GET", "/api/cockpit/open-pos")).body).toHaveLength(5);
  });
});

describe("projection (AC-PUR-6)", () => {
  it("serves item projections, optionally with the recommended PO", async () => {
    const p = (await api.call("GET", "/api/plan/projection/CMP-A?with_recommendations=false")).body;
    expect(p.first_stockout_date).toBeTruthy();
    expect(p.events.length).toBeGreaterThan(0);
    expect(p.events.some((e: any) => e.kind === "recommended_po")).toBe(false);
    const w = (await api.call("GET", "/api/plan/projection/CMP-A?with_recommendations=true")).body;
    expect(w.events.some((e: any) => e.kind === "recommended_po")).toBe(true);
    expect((await api.call("GET", "/api/plan/projection/FG-1000")).status).toBe(404);
  });
});

describe("purchase history (AC-PUR-7)", () => {
  it("merges invoices and the open PO book", async () => {
    const e = (await api.call("GET", "/api/purchase-history")).body.entries as any[];
    expect(e.filter((x) => x.status === "completed")).toHaveLength(6);
    expect(e.filter((x) => x.status === "open")).toHaveLength(5);
    const inv = e.find((x) => x.po_number === "V-PO-H1");
    expect(inv).toMatchObject({ item_no: "CMP-A", qty_received: 20, amount_received: 814.8, vendor_no: "V-100" });
    for (const k of ["description", "series", "model", "expected_date", "first_invoice_date", "last_invoice_date", "amount_ordered", "vendor_name"]) expect(inv).toHaveProperty(k);
  });
});
