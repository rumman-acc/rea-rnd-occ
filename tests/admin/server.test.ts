// @vitest-environment node
import { createSessionValue } from "@/server/auth";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { APP_VERSION } from "@/server/version";
import { installApi, type InstalledApi } from "../support/inprocess";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
});
afterEach(() => api.uninstall());

describe("settings", () => {
  it("returns defaults, saves a partial update, journals it", async () => {
    const d = await api.call("GET", "/api/settings");
    expect(d.status).toBe(200);
    expect(d.body.planningHorizonWeeks).toBe(26);
    const r = await api.call("PUT", "/api/settings", { companyName: " Globex ", planningHorizonWeeks: 12 });
    expect(r.status).toBe(200);
    expect(r.body.companyName).toBe("Globex");
    expect((await api.call("GET", "/api/settings")).body.planningHorizonWeeks).toBe(12);
    const a = await api.call("GET", "/api/admin/audit?source=admin&q=settings");
    expect(a.body.entries[0]).toMatchObject({ action: "settings.update", detail: "changed: companyName, planningHorizonWeeks" });
  });

  it.each([
    [{ companyName: "" }, "companyName"],
    [{ currency: "JPY" }, "currency"],
    [{ planningHorizonWeeks: 0 }, "planningHorizonWeeks"],
    [{ planningHorizonWeeks: 1.5 }, "planningHorizonWeeks"],
    [{ autoRefreshSeconds: 5 }, "autoRefreshSeconds"],
    [{ notificationEmail: "nope" }, "notificationEmail"],
    [{ timezone: "Mars/Base" }, "timezone"],
    [{ showDemoBadge: "yes" }, "showDemoBadge"],
    [{ bogus: 1 }, "Unknown setting"],
  ])("rejects %j", async (body, text) => {
    const r = await api.call("PUT", "/api/settings", body);
    expect(r.status).toBe(400);
    expect(r.body.detail).toContain(text);
    expect((await api.call("GET", "/api/settings")).body.planningHorizonWeeks).toBe(26);
  });
});

describe("backups", () => {
  it("create, change data, restore: data is back; backups do not nest", async () => {
    await api.call("PUT", "/api/settings", { companyName: "Before" });
    const b1 = await api.call("POST", "/api/admin/backups");
    expect(b1.body).toMatchObject({ id: "bkp-0001", createdBy: "demo", createdAt: "2026-10-19T19:11:44.000Z" });
    await api.call("PUT", "/api/settings", { companyName: "After", currency: "EUR" });
    const b2 = await api.call("POST", "/api/admin/backups");
    expect(b2.body.id).toBe("bkp-0002");
    expect(b2.body.bytes).toBeLessThan(b1.body.bytes * 3); // snapshot excludes the earlier backup
    const snap1 = api.store.get<Record<string, unknown>>("admin:backup:bkp-0001", () => ({}));
    expect(Object.keys(snap1).some((k) => k.startsWith("admin:backup"))).toBe(false);

    const r = await api.call("POST", "/api/admin/backups/bkp-0001/restore", { operator: "Ops Person" });
    expect(r.status).toBe(200);
    const s = (await api.call("GET", "/api/settings")).body;
    expect(s.companyName).toBe("Before");
    expect(s.currency).toBe("USD");
    // bookkeeping survives, and the restore is journaled
    expect((await api.call("GET", "/api/admin/backups")).body.backups.map((b: { id: string }) => b.id)).toEqual(["bkp-0002", "bkp-0001"]);
    const log = (await api.call("GET", "/api/admin/audit?q=restore")).body.entries;
    expect(log[0]).toMatchObject({ action: "backup.restore", actor: "Ops Person" });
  });

  it("restores master-data changes too, deletes, and 404s", async () => {
    const { master, updateMaster } = await import("@/server/master");
    const before = master(api.store, "customers").length;
    const b = await api.call("POST", "/api/admin/backups");
    updateMaster(api.store, "customers", (m) => void m.pop());
    expect(master(api.store, "customers").length).toBe(before - 1);
    await api.call("POST", `/api/admin/backups/${b.body.id}/restore`, {});
    expect(master(api.store, "customers").length).toBe(before);

    expect((await api.call("DELETE", `/api/admin/backups/${b.body.id}`)).status).toBe(200);
    expect((await api.call("GET", "/api/admin/backups")).body.backups).toEqual([]);
    expect((await api.call("DELETE", `/api/admin/backups/${b.body.id}`)).status).toBe(404);
    expect((await api.call("POST", `/api/admin/backups/${b.body.id}/restore`, {})).status).toBe(404);
  });
});

describe("upgrade, peer, integrations, releases, users, audit", () => {
  it("lists releases with the current version and simulates an upgrade without changing it", async () => {
    const rel = (await api.call("GET", "/api/admin/releases")).body;
    expect(rel.current).toBe(APP_VERSION);
    expect(rel.releases.find((r: { status: string }) => r.status === "current").version).toBe(APP_VERSION);
    const up = await api.call("POST", "/api/admin/upgrade", { version: "1.48.0", operator: "Alex" });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ id: "upg-0001", simulated: true, from: APP_VERSION, version: "1.48.0", operator: "Alex" });
    expect(up.body.steps.map((s: { name: string }) => s.name)).toEqual(["Queued", "Downloading package", "Verifying checksum", "Applying (simulated)", "Restarting (simulated)", "Completed"]);
    expect((await api.call("GET", "/api/version")).body.version).toBe(APP_VERSION);
    expect((await api.call("GET", "/api/admin/releases")).body.upgrades).toHaveLength(1);
    expect((await api.call("GET", "/api/admin/audit?q=upgrade")).body.entries[0]).toMatchObject({ action: "upgrade.simulate", actor: "Alex" });
  });

  it("validates upgrade input", async () => {
    expect((await api.call("POST", "/api/admin/upgrade", {})).status).toBe(400);
    expect((await api.call("POST", "/api/admin/upgrade", { version: "9.9.9" })).status).toBe(400);
    expect((await api.call("POST", "/api/admin/upgrade", { version: APP_VERSION })).status).toBe(400);
  });

  it("starts a deterministic simulated peer", async () => {
    const a = await api.call("POST", "/api/admin/peer/start");
    expect(a.body).toMatchObject({ id: "peer-1", status: "simulated", startedAt: "2026-10-19T19:11:44.000Z" });
    expect((await api.call("POST", "/api/admin/peer/start")).body.id).toBe("peer-2");
  });

  it("lists simulated integrations and seeded users", async () => {
    const i = (await api.call("GET", "/api/admin/integrations")).body.integrations;
    expect(i.map((x: { name: string }) => x.name)).toEqual(["Business Central", "External pricing app", "Mail"]);
    expect(i.every((x: { status: string }) => x.status === "simulated")).toBe(true);
    const u = (await api.call("GET", "/api/admin/users")).body.users;
    expect(u).toHaveLength(3);
    expect(JSON.stringify(u)).not.toContain("hash");
  });

  it("filters the audit journal by source and text", async () => {
    await api.call("POST", "/api/admin/peer/start");
    await api.call("PUT", "/api/settings", { currency: "GBP" });
    const all = (await api.call("GET", "/api/admin/audit")).body;
    expect(all.sources).toEqual(["admin"]);
    expect(all.entries.map((e: { action: string }) => e.action)).toEqual(["settings.update", "peer.start"]);
    expect((await api.call("GET", "/api/admin/audit?source=pricing&q=")).body.entries).toEqual([]);
    expect((await api.call("GET", "/api/admin/audit?source=admin&q=PEER")).body.entries).toHaveLength(1);
  });
});

describe("admin guard", () => {
  const as = async (role: string, method: string, path: string) => {
    const cookie = createSessionValue({ id: "x", email: "x@example.com", name: "X", role });
    const { createInProcessTransport } = await import("../support/inprocess");
    return createInProcessTransport()(path, { method, headers: { cookie: `occ_session=${cookie}` } });
  };

  it("forbids non-admin sessions and allows admins", async () => {
    expect((await as("Planner", "POST", "/api/admin/backups")).status).toBe(403);
    expect((await as("Planner", "GET", "/api/admin/audit")).status).toBe(403);
    expect((await as("Planner", "GET", "/api/settings")).status).toBe(200);
    const ok = await as("Admin", "POST", "/api/admin/backups");
    expect(ok.status).toBe(200);
    expect((await api.call("GET", "/api/admin/audit")).body.entries[0].actor).toBe("X");
  });
});
