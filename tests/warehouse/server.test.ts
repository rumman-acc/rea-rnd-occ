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

const C = "/api/cockpit";
const rcv = (po: string, lines: Record<string, unknown>[], extra: Record<string, unknown> = {}) =>
  api.call("POST", `${C}/receive`, { po_id: po, po_number: po, lines, ...extra });
const line = (id: string, item: string, qty: number, extra: Record<string, unknown> = {}) => ({ line_id: id, sequence: 1, item_no: item, qty, lot_no: "", bin_code: "A-01", close_line: false, ...extra });
const kpis = async () => (await api.call("GET", "/api/plan")).body.kpis;
const onHand = (item: string) => master(api.store, "components").find((c) => c.item_no === item)!.on_hand;
const stockOf = async (item: string) => (await api.call("GET", `${C}/item-stock?item_no=${item}`)).body as { bin: string; lot: string; qty: number }[];

describe("reads (AC-WH-01)", () => {
  it("bins and receiving to-do", async () => {
    const bins = (await api.call("GET", `${C}/bins`)).body;
    expect(bins).toHaveLength(8);
    expect(new Set(bins.map((b: { zone: string }) => b.zone)).size).toBe(4);
    const todo = (await api.call("GET", `${C}/receiving`)).body;
    expect(todo.pos.map((p: { po_number: string }) => p.po_number)).toEqual(["V-PO-5001", "V-PO-5003", "V-PO-5002", "V-PO-5004"]);
    expect(todo).toMatchObject({ al_mode: true, location: "MAIN", settings: { over_delivery_tolerance_pct: 5 } });
    expect(todo.pos[0].lines[0]).toMatchObject({ line_id: "V-PO-5001/1", outstanding: 8, suggested_bin: "A-01", overdue: false, lot_required: false });
    expect(todo.pos[0].lines).toHaveLength(2);
  });

  it("item stock validates and returns rows", async () => {
    expect((await api.call("GET", `${C}/item-stock`)).status).toBe(400);
    expect((await api.call("GET", `${C}/item-stock?item_no=NOPE`)).body).toEqual([]);
    const rows = await stockOf("CMP-A");
    expect(rows.reduce((t, r) => t + r.qty, 0)).toBe(20);
  });
});

describe("receiving (AC-WH-02..07)", () => {
  it("full receipt raises on_hand, closes the line, lowers expedites in the plan", async () => {
    expect((await kpis()).expedite_lines).toBe(3);
    const r = await rcv("V-PO-5001", [line("V-PO-5001/1", "CMP-A", 8)], { operator: "Pat", receipt_date: "2026-10-19" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "posted", operator: "Pat" });
    expect(r.body.lines[0].result).toBe("ok");
    expect(onHand("CMP-A")).toBe(28);
    expect(master(api.store, "vendor_po_lines").find((l) => l.po_number === "V-PO-5001" && l.line_no === "1")!.status).toBe("Received");
    const k = await kpis();
    expect(k.expedite_lines).toBe(2);
    expect(k.critical_items).toBe(3);
    expect(r.body.posting_date_change).toEqual({ changed: true, before: "2026-10-20", after: "2026-10-19" });
  });

  it("partial receipt keeps the remainder open", async () => {
    await rcv("V-PO-5001", [line("V-PO-5001/1", "CMP-A", 3)]);
    expect(master(api.store, "vendor_po_lines")[0]).toMatchObject({ status: "Open", quantity: 5 });
    const po = (await api.call("GET", `${C}/receiving`)).body.pos.find((p: { po_number: string }) => p.po_number === "V-PO-5001");
    expect(po.lines[0]).toMatchObject({ received: 3, outstanding: 5, ordered: 8 });
    expect(po.received_lines).toHaveLength(1);
  });

  it("over-delivery follows the tolerance setting", async () => {
    const bad = await rcv("V-PO-5001", [line("V-PO-5001/1", "CMP-A", 9)]);
    expect(bad.body.status).toBe("rejected");
    expect(bad.body.errors[0]).toContain("8.4");
    expect(onHand("CMP-A")).toBe(20);
    expect((await rcv("V-PO-5001", [line("V-PO-5001/1", "CMP-A", 8.4)])).body.status).toBe("posted");
    await api.call("PUT", `${C}/warehouse-settings`, { operator: "x", values: { over_delivery_tolerance_pct: 100 } });
    expect((await rcv("V-PO-5004", [line("V-PO-5004/1", "CMP-D", 60, { bin_code: "BLK-01" })])).body.status).toBe("posted");
  });

  it("tolerance 0 disables over-delivery", async () => {
    await api.call("PUT", `${C}/warehouse-settings`, { values: { over_delivery_tolerance_pct: 0 } });
    expect((await rcv("V-PO-5001", [line("V-PO-5001/1", "CMP-A", 9)])).body.status).toBe("rejected");
    expect((await rcv("V-PO-5001", [line("V-PO-5001/1", "CMP-A", 8)])).body.status).toBe("posted");
  });

  it("lot-tracked items need a lot", async () => {
    const no = await rcv("V-PO-5002", [line("V-PO-5002/1", "CMP-C", 6)]);
    expect(no.body.status).toBe("rejected");
    expect(no.body.errors[0]).toContain("CMP-C");
    const ok = await rcv("V-PO-5002", [line("V-PO-5002/1", "CMP-C", 6, { lot_no: "L-NEW", bin_code: "A-02" })]);
    expect(ok.body.status).toBe("posted");
    expect((await stockOf("CMP-C")).find((r) => r.lot === "L-NEW")).toMatchObject({ bin: "A-02", qty: 6 });
  });

  it("close short cuts the order; PO becomes completed", async () => {
    await rcv("V-PO-5004", [line("V-PO-5004/1", "CMP-D", 10, { bin_code: "BLK-01", close_line: true })]);
    expect(master(api.store, "vendor_po_lines").find((l) => l.po_number === "V-PO-5004")).toMatchObject({ status: "Received", quantity: 10 });
    const done = (await api.call("GET", `${C}/completed-pos`)).body;
    expect(done.map((p: { po_number: string }) => p.po_number)).toEqual(["V-PO-5004", "V-PO-4990"]);
    expect(done[0]).toMatchObject({ received_via_app: true, vendor_no: "V-300" });
    expect(done[1]).toMatchObject({ received_via_app: false, last_receipt_date: "2026-10-02" });
    const lines = (await api.call("GET", `${C}/po-received-lines?po_id=V-PO-5004`)).body;
    expect(lines[0]).toMatchObject({ item_no: "CMP-D", received: 10, ordered: 10 });
    expect((await rcv("V-PO-5004", [line("V-PO-5004/1", "CMP-D", 1)])).body.errors[0]).toContain("already fully received");
    expect((await api.call("GET", `${C}/po-received-lines`)).status).toBe(400);
    expect((await api.call("GET", `${C}/po-received-lines?po_id=NOPE`)).status).toBe(404);
  });

  it("rejections change nothing and are journaled; structural errors are 400/404", async () => {
    const r = await rcv("V-PO-5001", [line("V-PO-5001/1", "CMP-B", 1), line("V-PO-5001/9", "CMP-A", 1), line("V-PO-5001/2", "CMP-A", 0, { bin_code: "ZZ" })]);
    expect(r.status).toBe(200);
    expect(r.body.errors.length).toBeGreaterThanOrEqual(4);
    expect(onHand("CMP-A")).toBe(20);
    const h = (await api.call("GET", `${C}/warehouse-history?kind=receipt`)).body;
    expect(h[0]).toMatchObject({ status: "rejected", po_number: "V-PO-5001" });
    expect((await api.call("POST", `${C}/receive`, { lines: [] })).status).toBe(400);
    expect((await api.call("POST", `${C}/receive`, { po_id: "V-PO-5001", lines: [] })).status).toBe(400);
    expect((await api.call("POST", `${C}/receive`, { po_id: "V-PO-5001", lines: [{ line_id: "a", item_no: "b", qty: "x" }] })).status).toBe(400);
    expect((await api.call("POST", `${C}/receive`, { po_id: "V-PO-5001", receipt_date: "x", lines: [line("V-PO-5001/1", "CMP-A", 1)] })).status).toBe(400);
    expect((await rcv("NOPE", [line("NOPE/1", "CMP-A", 1)])).status).toBe(404);
  });

  it("uses the actor when no operator is sent", async () => {
    await rcv("V-PO-5001", [line("V-PO-5001/1", "CMP-A", 1)]);
    expect(listAudit(api.store, { source: "warehouse" })[0]).toMatchObject({ action: "receipt.post", actor: "demo" });
  });
});

describe("movements (AC-WH-08, 09)", () => {
  it("moves stock between bins without touching on_hand", async () => {
    const r = await api.call("POST", `${C}/movement`, { kind: "move", operator: "Lee", item_no: "CMP-B", qty: 5, from_bin: "B-01", to_bin: "A-01" });
    expect(r.body).toMatchObject({ type: "move", status: "posted", from_bin: "B-01", to_bin: "A-01", operator: "Lee" });
    const rows = await stockOf("CMP-B");
    expect(rows.find((x) => x.bin === "A-01")!.qty).toBe(5);
    expect(rows.find((x) => x.bin === "B-01")!.qty).toBe(31);
    expect(onHand("CMP-B")).toBe(60);
  });

  it("rejects bad movements", async () => {
    const mv = (b: Record<string, unknown>) => api.call("POST", `${C}/movement`, { kind: "move", item_no: "CMP-B", qty: 1, from_bin: "B-01", to_bin: "A-01", ...b });
    expect((await mv({ qty: 999 })).status).toBe(400);
    expect((await mv({ to_bin: "B-01" })).status).toBe(400);
    expect((await mv({ to_bin: "ZZ" })).status).toBe(400);
    expect((await mv({ qty: 0 })).status).toBe(400);
    expect((await mv({ item_no: "NOPE" })).status).toBe(404);
    expect((await mv({ kind: "x" })).status).toBe(400);
    expect((await mv({ item_no: "CMP-C", from_bin: "A-02" })).body.detail).toContain("lot");
  });

  it("lot move keeps the lot", async () => {
    const lot = (await stockOf("CMP-C")).find((r) => r.bin === "A-02")!.lot;
    await api.call("POST", `${C}/movement`, { kind: "move", item_no: "CMP-C", qty: 2, lot_no: lot, from_bin: "A-02", to_bin: "B-01" });
    expect((await stockOf("CMP-C")).find((r) => r.bin === "B-01")).toMatchObject({ lot, qty: 2 });
  });

  it("adjustment changes on_hand and the plan", async () => {
    expect((await kpis()).critical_items).toBe(3);
    const r = await api.call("POST", `${C}/movement`, { kind: "adjust", item_no: "CMP-A", qty: 12, bin_code: "A-01", reason: "count" });
    expect(r.body).toMatchObject({ type: "adjust", qty: 12, reason: "count" });
    expect(onHand("CMP-A")).toBe(32);
    expect((await kpis()).critical_items).toBe(2);
    expect((await api.call("POST", `${C}/movement`, { kind: "adjust", item_no: "CMP-A", qty: -999, bin_code: "A-01" })).status).toBe(400);
    expect((await api.call("POST", `${C}/movement`, { kind: "adjust", item_no: "CMP-A", qty: -2 })).status).toBe(400);
  });
});

describe("settings, history, audit (AC-WH-10, 11)", () => {
  it("persists settings and validates", async () => {
    const put = await api.call("PUT", `${C}/warehouse-settings`, { operator: "Sam", values: { over_delivery_tolerance_pct: 10, printer: { label_printer: "ZB1", document_printer: "" }, scanner: { mode: "camera" }, barcode: { symbology: "qr" } } });
    expect(put.body).toMatchObject({ over_delivery_tolerance_pct: 10, scanner: { mode: "camera" } });
    expect((await api.call("GET", `${C}/warehouse-settings`)).body.printer.label_printer).toBe("ZB1");
    for (const values of [{ over_delivery_tolerance_pct: 101 }, { scanner: { mode: "x" } }, { barcode: { symbology: "y" } }])
      expect((await api.call("PUT", `${C}/warehouse-settings`, { values })).status).toBe(400);
    expect((await api.call("PUT", `${C}/warehouse-settings`, {})).status).toBe(400);
    expect(listAudit(api.store, { source: "warehouse" })[0]).toMatchObject({ action: "settings.update", actor: "Sam" });
  });

  it("history filters by kind, newest first; one audit entry per action", async () => {
    await rcv("V-PO-5001", [line("V-PO-5001/1", "CMP-A", 1)]);
    await api.call("POST", `${C}/movement`, { kind: "move", item_no: "CMP-B", qty: 1, from_bin: "B-01", to_bin: "A-01" });
    await api.call("POST", `${C}/movement`, { kind: "adjust", item_no: "CMP-A", qty: 1, bin_code: "A-01" });
    const all = (await api.call("GET", `${C}/warehouse-history?kind=`)).body;
    expect(all.map((h: { type: string }) => h.type)).toEqual(["adjust", "move", "receipt"]);
    expect((await api.call("GET", `${C}/warehouse-history?kind=move`)).body).toHaveLength(1);
    expect((await api.call("GET", `${C}/warehouse-history?kind=x`)).status).toBe(400);
    expect(listAudit(api.store, { source: "warehouse" }).map((a) => a.action).reverse()).toEqual(["receipt.post", "movement.move", "movement.adjust"]);
  });
});
