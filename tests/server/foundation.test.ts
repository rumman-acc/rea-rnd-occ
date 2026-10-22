// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FX_KPI, FX_ROWS } from "@/data/fixtures";
import { appendAudit, listAudit } from "@/server/audit";
import { createResetToken, createSessionValue, verifySessionValue } from "@/server/auth";
import { componentBalances, updateMaster } from "@/server/master";
import { computeKpis, computePlan, planLines } from "@/server/plan";
import { createMemoryStore } from "@/server/store";
import { installApi, type InstalledApi } from "../support/inprocess";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
});
afterEach(() => api.uninstall());

describe("store", () => {
  it("seeds lazily and hands out copies", () => {
    const s = createMemoryStore();
    const a = s.get("k", () => ({ n: 1 }));
    a.n = 99;
    expect(s.get("k", () => ({ n: 5 }))).toEqual({ n: 1 });
  });

  it("update persists the draft and returns the callback result", () => {
    const s = createMemoryStore();
    const r = s.update("k", () => ({ n: 1 }), (d) => ++d.n);
    expect(r).toBe(2);
    expect(s.get("k", () => ({ n: 0 }))).toEqual({ n: 2 });
  });

  it("snapshot and restore round-trip", () => {
    const s = createMemoryStore();
    s.set("a", { x: 1 });
    const snap = s.snapshot();
    s.set("a", { x: 2 });
    s.restore(snap);
    expect(s.get("a", () => null)).toEqual({ x: 1 });
  });
});

describe("plan computed from seed master data (SPEC-FULL D6)", () => {
  it("reproduces the dashboard fixture rows, in order", () => {
    const cols = (r: { so_number: string; customer_name: string | null; series: string | null; delivery_date: string | null; quantity: number; unit_price: number; health: string }) =>
      [r.so_number, r.customer_name, r.series, r.delivery_date, r.quantity, r.unit_price, r.health];
    expect(computePlan(api.store).status_board.map(cols)).toEqual(FX_ROWS.map(cols));
  });

  it("reproduces the fixture KPIs; revenue at risk is red + 30% of yellow", () => {
    const k = computeKpis(api.store);
    expect({ ...k, revenue_at_risk: Math.round(k.revenue_at_risk) }).toEqual(FX_KPI);
    expect(k.revenue_at_risk).toBe(30910 + 0.3 * 9825);
  });

  it("health follows the documented rule", () => {
    const by = Object.fromEntries(planLines(api.store).map((l) => [l.so_number, l]));
    expect(by["S-ORD101007"].linked_po).toBeNull(); // unlinked → red
    expect(by["S-ORD101001"].on_time).toBe(false); // late → red
    expect(by["S-ORD101008"].material_short && by["S-ORD101008"].on_time).toBe(true); // yellow
    expect(by["S-ORD101002"].health).toBe("green");
  });

  it("three components are short", () => {
    expect(componentBalances(api.store).filter((b) => b.short).map((b) => b.item_no)).toEqual(["CMP-A", "CMP-C", "CMP-E"]);
  });

  it("is served by GET /api/plan, /api/version and POST /api/plan/simulate", async () => {
    const plan = await api.call("GET", "/api/plan?refresh=true");
    expect(plan.status).toBe(200);
    expect(plan.body.kpis.open_so_lines).toBe(8);
    expect(plan.body.generated_at).toBe("2026-10-19T19:11:44");
    expect((await api.call("GET", "/api/version")).body).toEqual({ version: "1.47.0" });
    const sim = await api.call("POST", "/api/plan/simulate", { overrides: [], new_orders: [] });
    expect(sim.body.kpis).toEqual(plan.body.kpis);
  });

  it("reports deployment health without mutating the store", async () => {
    const before = api.store.snapshot();
    const health = await api.call("GET", "/api/health");
    expect(health).toEqual({
      status: 200,
      body: { status: "ok", version: "1.47.0", store: "available", documents: 0 },
    });
    expect(api.store.snapshot()).toEqual(before);
  });

  it("reflects master-data changes (nothing is hard-coded)", async () => {
    updateMaster(api.store, "sales_lines", (d) => void d.splice(0, 1));
    const plan = (await api.call("GET", "/api/plan")).body;
    expect(plan.kpis.open_so_lines).toBe(7);
  });
});

describe("auth stub (SPEC-FULL D8)", () => {
  it("logs in, rejects bad credentials, reports the session", async () => {
    const bad = await api.call("POST", "/api/auth/login", { email: "alex.morgan@example.com", password: "nope" });
    expect(bad.status).toBe(401);
    const missing = await api.call("POST", "/api/auth/login", { email: "x" });
    expect(missing.status).toBe(400);

    const ok = await api.call("POST", "/api/auth/login", { email: "ALEX.MORGAN@example.com", password: "demo1234" });
    expect(ok.status).toBe(200);
    expect(ok.body.user).toMatchObject({ name: "Alex Morgan", role: "Admin" });
    expect(listAudit(api.store, { source: "auth" })[0].action).toBe("login");
  });

  it("signs and verifies session cookies, rejecting tampering and expiry", () => {
    const user = { id: "u", email: "a@b.c", name: "A B", role: "Admin" };
    const v = createSessionValue(user, 1_000_000);
    expect(verifySessionValue(v, 1_000_000 + 1000)).toEqual(user);
    expect(verifySessionValue(v + "x", 1_000_000)).toBeNull();
    expect(verifySessionValue(v, 1_000_000 + 9 * 3600 * 1000)).toBeNull();
    expect(verifySessionValue(undefined)).toBeNull();
  });

  it("password reset changes the password and consumes the token", async () => {
    const forgot = await api.call("POST", "/api/auth/forgot", { email: "alex.morgan@example.com" });
    const token = forgot.body.token as string;
    expect(token).toBeTruthy();
    expect((await api.call("POST", "/api/auth/forgot", { email: "nobody@example.com" })).body.token).toBeNull();
    expect((await api.call("POST", "/api/auth/reset", { token, password: "short" })).status).toBe(400);
    expect((await api.call("POST", "/api/auth/reset", { token, password: "a-new-password" })).status).toBe(200);
    expect((await api.call("POST", "/api/auth/reset", { token, password: "a-new-password" })).status).toBe(400);
    const oldLogin = await api.call("POST", "/api/auth/login", { email: "alex.morgan@example.com", password: "demo1234" });
    expect(oldLogin.status).toBe(401);
    const newLogin = await api.call("POST", "/api/auth/login", { email: "alex.morgan@example.com", password: "a-new-password" });
    expect(newLogin.status).toBe(200);
    expect(createResetToken(api.store, "nobody@example.com")).toBeNull();
  });
});

describe("audit journal (ARC-F04)", () => {
  it("lists newest first and filters by source and text", () => {
    appendAudit(api.store, { source: "a", actor: "x", action: "one", detail: "alpha" });
    appendAudit(api.store, { source: "b", actor: "x", action: "two", detail: "beta" });
    expect(listAudit(api.store).map((e) => e.action)).toEqual(["two", "one"]);
    expect(listAudit(api.store, { source: "a" })).toHaveLength(1);
    expect(listAudit(api.store, { q: "BETA" })).toHaveLength(1);
  });
});

describe("handler wrapper", () => {
  it("maps unknown routes to 404 and bad JSON to 400", async () => {
    expect((await api.call("GET", "/api/nope")).status).toBe(404);
    const { createInProcessTransport } = await import("../support/inprocess");
    const res = await createInProcessTransport()("/api/auth/login", { method: "POST", body: "{not json" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ detail: "Invalid JSON body" });
  });
});
