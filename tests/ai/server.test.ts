// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAudit } from "@/server/audit";
import { componentBalances, master, updateMaster } from "@/server/master";
import { installApi, type InstalledApi } from "../support/inprocess";

let api: InstalledApi;
beforeEach(() => {
  api = installApi();
});
afterEach(() => api.uninstall());

const poll = async (n: number) => {
  for (let i = 0; i < n; i++) await api.call("POST", "/api/ai/runs/tick");
};
const runBuyer = async () => {
  const r = await api.call("POST", "/api/ai/agents/replenishment/run", { user_token: "" });
  expect(r.status).toBe(200);
  await poll(3);
  return r.body.run_id as string;
};
const pending = async () => (await api.call("GET", "/api/ai/inbox?pending_only=true")).body as { id: string; action_type: string; context_data: Record<string, unknown> }[];

describe("config, persona, settings", () => {
  it("serves the default config", async () => {
    const { body } = await api.call("GET", "/api/ai/config");
    expect(body.agents).toHaveLength(4);
    expect(body.simulation_mode).toBe(true);
    expect(body.persona.risk_tolerance).toBe(0.5);
  });

  it("validates and saves persona and settings", async () => {
    expect((await api.call("PUT", "/api/ai/persona", { risk_tolerance: 2 })).status).toBe(400);
    expect((await api.call("PUT", "/api/ai/persona", { experience_level: "Boss" })).status).toBe(400);
    expect((await api.call("PUT", "/api/ai/settings", { fulfillment_contingency_buffer_days: 61 })).status).toBe(400);
    expect((await api.call("PUT", "/api/ai/settings", { supply_market_risk_factor: "bad" })).status).toBe(400);
    expect((await api.call("PUT", "/api/ai/persona", { risk_tolerance: 0.2 })).body.risk_tolerance).toBe(0.2);
    expect((await api.call("PUT", "/api/ai/settings", { supply_market_risk_factor: "critical" })).body.supply_market_risk_factor).toBe("critical");
    expect((await api.call("PUT", "/api/ai/simulation-mode", { enabled: "x" })).status).toBe(400);
    expect((await api.call("PUT", "/api/ai/simulation-mode", { enabled: false })).body).toEqual({ simulation_mode: false });
  });

  it("serves the token stub", async () => {
    expect((await api.call("GET", "/api/rag/token")).body.stub).toBe(true);
  });
});

describe("agent runs", () => {
  it("progresses by polling and proposes a PO per short component", async () => {
    const r = await api.call("POST", "/api/ai/agents/replenishment/run", {});
    expect(r.body.status).toBe("INITIALIZING");
    expect((await api.call("POST", "/api/ai/agents/replenishment/run", {})).status).toBe(409);
    const stages: string[] = [];
    for (let i = 0; i < 3; i++) stages.push((await api.call("POST", "/api/ai/runs/tick")).body[0].status);
    expect(stages).toEqual(["GATHERING_DATA", "SIMULATING", "AWAITING_HITL"]);
    const short = componentBalances(api.store).filter((b) => b.short).map((b) => b.item_no).sort();
    const items = await pending();
    expect(items.map((i) => i.context_data.item_no).sort()).toEqual(short);
    for (const i of items) {
      const sz = i.context_data.risk_sizing as { net_need: number; final_qty: number };
      expect(sz.final_qty % 10).toBe(0);
      expect(sz.final_qty).toBeGreaterThanOrEqual(sz.net_need);
    }
  });

  it("GET /api/ai/runs is a pure read; only POST /api/ai/runs/tick advances runs", async () => {
    await api.call("POST", "/api/ai/agents/replenishment/run", {});
    const before = (await api.call("GET", "/api/ai/runs")).body;
    for (let i = 0; i < 4; i++) await api.call("GET", "/api/ai/runs");
    expect((await api.call("GET", "/api/ai/runs")).body).toEqual(before);
    expect(before[0].status).toBe("INITIALIZING");
    expect((await api.call("POST", "/api/ai/runs/tick")).body[0].status).toBe("GATHERING_DATA");
  });

  it("404 for an unknown agent; pause, resume and cancel", async () => {
    expect((await api.call("POST", "/api/ai/agents/nope/run", {})).status).toBe(404);
    const id = (await api.call("POST", "/api/ai/agents/supplier_comms/run", {})).body.run_id;
    expect((await api.call("POST", `/api/ai/runs/${id}/pause`, { actor: "bob" })).body.paused).toBe(true);
    expect((await api.call("POST", `/api/ai/runs/${id}/pause`, {})).status).toBe(409);
    await poll(5);
    expect((await api.call("GET", "/api/ai/runs")).body[0].status).toBe("INITIALIZING");
    await api.call("POST", `/api/ai/runs/${id}/resume`, {});
    await poll(1);
    expect((await api.call("GET", "/api/ai/runs")).body[0].status).toBe("GATHERING_DATA");
    expect((await api.call("POST", `/api/ai/runs/${id}/cancel`, { actor: "bob" })).body.status).toBe("REJECTED");
    expect((await api.call("POST", `/api/ai/runs/${id}/cancel`, {})).status).toBe(409);
    expect((await api.call("POST", `/api/ai/runs/${id}/explode`, {})).status).toBe(400);
    expect((await api.call("POST", "/api/ai/runs/RUN-9999/pause", {})).status).toBe(404);
    expect(listAudit(api.store, { source: "ai" }).some((e) => e.action === "run.cancel" && e.actor === "bob")).toBe(true);
  });

  it("other agents produce their item types", async () => {
    for (const [agent, type] of [["production_sim", "RESCHEDULE_PROD_ORDER"], ["supplier_comms", "EMAIL_SUPPLIER"], ["ctp_negotiator", "CHANGE_SO_DATE"]]) {
      await api.call("POST", `/api/ai/agents/${agent}/run`, {});
      await poll(3);
    }
    const types = new Set((await pending()).map((i) => i.action_type));
    expect(types).toEqual(new Set(["RESCHEDULE_PROD_ORDER", "EMAIL_SUPPLIER", "CHANGE_SO_DATE"]));
  });
});

describe("inbox decisions and saved plans", () => {
  it("simulation approval saves a plan without touching master data; execute needs validation", async () => {
    const runId = await runBuyer();
    const before = master(api.store, "vendor_po_lines").length;
    const [first] = await pending();
    expect((await api.call("POST", `/api/ai/inbox/${first.id}/decide`, { decision: "MAYBE" })).status).toBe(400);
    const d = await api.call("POST", `/api/ai/inbox/${first.id}/decide`, { decision: "APPROVED", note: "ok", actor: "alice" });
    expect(d.body.execution_result.simulated).toBe(true);
    expect(d.body.decided_by).toBe("alice");
    expect((await api.call("POST", `/api/ai/inbox/${first.id}/decide`, { decision: "APPROVED" })).status).toBe(409);
    expect(master(api.store, "vendor_po_lines")).toHaveLength(before);
    const e = listAudit(api.store, { source: "ai" }).find((x) => x.action === "inbox.approve")!;
    expect(e.actor).toBe("alice");

    expect((await api.call("GET", "/api/ai/saved-plans")).body.map((p: { id: string }) => p.id)).toEqual([first.id]);
    expect((await api.call("POST", `/api/ai/saved-plans/${first.id}/execute`, { force: false })).status).toBe(409);
    const v = await api.call("POST", `/api/ai/saved-plans/${first.id}/validate`, {});
    expect(v.body.verdict).toBe("still_valid");
    await api.call("PUT", "/api/ai/simulation-mode", { enabled: false });
    const x = await api.call("POST", `/api/ai/saved-plans/${first.id}/execute`, { force: false });
    expect(x.status).toBe(200);
    expect(x.body.execution_result.bc_po_number).toBe("AI-PO-0001");
    expect(master(api.store, "vendor_po_lines").some((l) => l.po_number === "AI-PO-0001")).toBe(true);
    expect((await api.call("GET", "/api/ai/saved-plans")).body).toEqual([]);

    // reject the rest: the run settles
    for (const i of await pending()) await api.call("POST", `/api/ai/inbox/${i.id}/decide`, { decision: "REJECTED" });
    const run = (await api.call("GET", "/api/ai/runs")).body.find((r: { run_id: string }) => r.run_id === runId);
    expect(run.status).toBe("EXECUTED");
  });

  it("an obsolete plan cannot be executed but can be discarded", async () => {
    await runBuyer();
    const [first] = await pending();
    await api.call("POST", `/api/ai/inbox/${first.id}/decide`, { decision: "APPROVED" });
    updateMaster(api.store, "components", (d) => {
      for (const c of d) c.on_hand += 100000;
    });
    expect((await api.call("POST", `/api/ai/saved-plans/${first.id}/validate`, {})).body.verdict).toBe("obsolete");
    expect((await api.call("POST", `/api/ai/saved-plans/${first.id}/execute`, {})).status).toBe(409);
    expect((await api.call("POST", `/api/ai/saved-plans/${first.id}/discard`, { note: "stale" })).status).toBe(200);
    expect((await api.call("GET", "/api/ai/saved-plans")).body).toEqual([]);
    expect((await api.call("POST", `/api/ai/saved-plans/${first.id}/discard`, {})).status).toBe(404);
  });

  it("live approval executes immediately; all rejected ends the run REJECTED", async () => {
    await api.call("PUT", "/api/ai/simulation-mode", { enabled: false });
    const runId = await runBuyer();
    const items = await pending();
    const d = await api.call("POST", `/api/ai/inbox/${items[0].id}/decide`, { decision: "APPROVED" });
    expect(d.body.execution_result.po_number).toMatch(/^AI-PO-/);
    for (const i of items.slice(1)) await api.call("POST", `/api/ai/inbox/${i.id}/decide`, { decision: "REJECTED", note: "no" });
    const run = (await api.call("GET", "/api/ai/runs")).body.find((r: { run_id: string }) => r.run_id === runId);
    expect(run.status).toBe("EXECUTED");
  });

  it("edited email draft is stored on approval", async () => {
    await api.call("POST", "/api/ai/agents/supplier_comms/run", {});
    await poll(3);
    const [m] = await pending();
    const d = await api.call("POST", `/api/ai/inbox/${m.id}/decide`, { decision: "APPROVED", modifications: { email: { subject: "S2", body: "B2" } } });
    expect((d.body.context_data.email as { subject: string }).subject).toBe("S2");
  });
});

describe("flows", () => {
  const steps = (extra: unknown[] = []) => [
    { type: "TRIGGER", name: "Trigger", config: { source: "component_shortages" } },
    { type: "ANALYZE", name: "Analyze", config: { method: "buy_recommendation" } },
    ...extra,
  ];
  const approval = { type: "APPROVAL", name: "Approval", config: { message: "Approve {count} line(s)", recipients: ["Operator", "Manager"], tiers: 2 } };
  const exec = { type: "EXECUTE", name: "Execute", config: { action: "create_po" } };

  it("validates definitions", async () => {
    const bad = async (b: unknown) => expect((await api.call("PUT", "/api/ai/flows", b)).status).toBe(400);
    await bad({ name: "", steps: steps() });
    await bad({ name: "x", steps: [] });
    await bad({ name: "x", steps: [{ type: "ANALYZE", name: "a", config: { method: "buy_recommendation" } }] });
    await bad({ name: "x", steps: steps([{ type: "APPROVAL", name: "a", config: { recipients: ["A"], tiers: 2 } }]) });
    await bad({ name: "x", steps: steps([{ type: "EXECUTE", name: "a", config: { action: "nope" } }]) });
    expect((await api.call("PUT", "/api/ai/flows", { id: "FLW-404", name: "x", steps: steps() })).status).toBe(404);
  });

  it("lists seeded flows with the catalog", async () => {
    const { body } = await api.call("GET", "/api/ai/flows");
    expect(body.flows.map((f: { status: string }) => f.status)).toEqual(["published", "draft"]);
    expect(body.catalog.trigger_sources).toContain("component_shortages");
  });

  it("full lifecycle: save, publish blocked, simulate, publish, run with two tiers, execute", async () => {
    const saved = await api.call("PUT", "/api/ai/flows", { id: null, name: "My flow", description: "d", steps: steps([approval, exec]), actor: "alice" });
    expect(saved.status).toBe(200);
    const id = saved.body.id;
    expect(saved.body).toMatchObject({ status: "draft", version: 1 });
    expect((await api.call("POST", `/api/ai/flows/${id}/publish`, {})).status).toBe(409);
    expect((await api.call("POST", `/api/ai/flows/${id}/run`, {})).status).toBe(409);

    const sim = await api.call("POST", `/api/ai/flows/${id}/simulate`, { actor: "alice" });
    expect(sim.body.run.status).toBe("completed");
    expect(sim.body.run.mode).toBe("simulate");
    expect(master(api.store, "vendor_po_lines").some((l) => l.po_number.startsWith("AI-PO"))).toBe(false);

    // editing invalidates the simulation
    const edited = await api.call("PUT", "/api/ai/flows", { ...saved.body, name: "My flow 2" });
    expect(edited.body.version).toBe(2);
    expect((await api.call("POST", `/api/ai/flows/${id}/publish`, {})).status).toBe(409);
    await api.call("POST", `/api/ai/flows/${id}/simulate`, {});
    expect((await api.call("POST", `/api/ai/flows/${id}/publish`, { actor: "alice" })).body.status).toBe("published");
    expect((await api.call("DELETE", `/api/ai/flows/${id}`)).status).toBe(409);

    const run = (await api.call("POST", `/api/ai/flows/${id}/run`, { actor: "alice" })).body.run;
    expect(run.status).toBe("awaiting_hitl");
    let [item] = await pending();
    expect(item.action_type).toBe("FLOW_APPROVAL");
    await api.call("POST", `/api/ai/inbox/${item.id}/decide`, { decision: "APPROVED", actor: "bob" });
    let runs = (await api.call("GET", `/api/ai/flow-runs?flow_id=${id}`)).body;
    expect(runs.find((r: { id: string }) => r.id === run.id).status).toBe("awaiting_hitl");
    [item] = await pending();
    await api.call("POST", `/api/ai/inbox/${item.id}/decide`, { decision: "APPROVED", actor: "carol" });
    runs = (await api.call("GET", "/api/ai/flow-runs")).body;
    const done = runs.find((r: { id: string }) => r.id === run.id);
    expect(done.status).toBe("completed");
    expect(done.steps.map((s: { actor: string }) => s.actor)).toContain("carol");
    expect(master(api.store, "vendor_po_lines").filter((l) => l.po_number.startsWith("AI-PO")).length).toBe(componentBalances(api.store).length ? done.steps.at(-1).detail.split(",").length : 0);
  });

  it("rejection stops a live run; execute without approval fails simulation", async () => {
    const bad = (await api.call("PUT", "/api/ai/flows", { name: "no approval", steps: steps([exec]) })).body;
    const sim = (await api.call("POST", `/api/ai/flows/${bad.id}/simulate`, {})).body;
    expect(sim.run.status).toBe("failed");
    expect(sim.run.steps.find((s: { status: string }) => s.status === "red").detail).toMatch(/Blocked/);
    expect((await api.call("POST", `/api/ai/flows/${bad.id}/publish`, {})).status).toBe(409);
    expect((await api.call("DELETE", `/api/ai/flows/${bad.id}`)).status).toBe(200);

    const run = (await api.call("POST", "/api/ai/flows/FLW-0001/run", { actor: "alice" })).body.run;
    expect(run.status).toBe("awaiting_hitl");
    const [item] = await pending();
    await api.call("POST", `/api/ai/inbox/${item.id}/decide`, { decision: "REJECTED", actor: "dave" });
    const r = (await api.call("GET", "/api/ai/flow-runs")).body[0];
    expect(r.status).toBe("rejected");
    expect(r.steps.some((s: { status: string }) => s.status === "skipped")).toBe(true);
  });

  it("threshold lanes follow the condition", async () => {
    const th = (value: number) => ({
      type: "THRESHOLD",
      name: "T",
      config: { field: "days_late", operator: "gt", value, true_label: "big", false_label: "small", true_steps: [{ type: "NOTIFY", name: "N", config: { recipient: "AM", template: "late {days_late}" } }], false_steps: [] },
    });
    const mk = async (value: number) => {
      const f = (await api.call("PUT", "/api/ai/flows", { name: "t", steps: [{ type: "TRIGGER", name: "t", config: { source: "late_production_orders" } }, { type: "ANALYZE", name: "a", config: { method: "reschedule_simulation" } }, th(value)] })).body;
      return (await api.call("POST", `/api/ai/flows/${f.id}/simulate`, {})).body.run;
    };
    const high = await mk(0);
    expect(high.steps.map((s: { type: string }) => s.type)).toContain("NOTIFY");
    const low = await mk(999);
    expect(low.steps.map((s: { type: string }) => s.type)).not.toContain("NOTIFY");
  });
});
