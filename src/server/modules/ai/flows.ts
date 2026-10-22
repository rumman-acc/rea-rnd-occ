import { badRequest, conflict, notFound } from "@/server/http";
import { nowIso } from "@/server/clock";
import type { Store } from "@/server/store";
import { KEYS, addInboxItem, audit, listFlowRuns, nextId } from "./core";
import { executeItem } from "./executors";
import { ENGINE } from "./proposals";
import type { Flow, FlowRun, FlowRunStep, FlowState, FlowStep } from "./types";

// Flow definitions, validation and the deterministic flow engine (spec REQ-AI-FLOW-RULE-*). All P.

export const CATALOG = {
  trigger_sources: Object.keys(ENGINE),
  analyze_methods: Object.values(ENGINE).map((e) => e.method),
  execute_actions: Object.values(ENGINE).map((e) => e.action),
  threshold_fields: ["po_value", "quantity", "days_late", "net_need"],
  threshold_operators: ["gt", "gte", "lt", "lte"],
};
const DATASETS = ["bom", "projections", "po_receipts", "capacity", "vendor_stats"];
const KINDS = ["TRIGGER", "GATHER", "ANALYZE", "THRESHOLD", "APPROVAL", "EXECUTE", "NOTIFY"];

type Cfg = Record<string, unknown>;
const isObj = (v: unknown): v is Cfg => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = (v: unknown, list: string[], what: string): string => {
  if (typeof v !== "string" || !list.includes(v)) throw badRequest(`${what} must be one of: ${list.join(", ")}`);
  return v;
};

function cleanStep(raw: unknown, nested: boolean, id: string): FlowStep {
  if (!isObj(raw)) throw badRequest("Each step must be an object");
  const type = oneOf(raw.type, KINDS, "Step type") as FlowStep["type"];
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 120) : type;
  const c: Cfg = isObj(raw.config) ? raw.config : {};
  let config: Cfg = {};
  switch (type) {
    case "TRIGGER":
      config = { source: oneOf(c.source, CATALOG.trigger_sources, "Trigger source") };
      break;
    case "GATHER": {
      const data = Array.isArray(c.data) ? c.data : [];
      if (data.some((d) => !DATASETS.includes(String(d)))) throw badRequest(`Gather datasets must be from: ${DATASETS.join(", ")}`);
      config = { data };
      break;
    }
    case "ANALYZE":
      config = { method: oneOf(c.method, CATALOG.analyze_methods, "Analysis method") };
      break;
    case "EXECUTE":
      config = { action: oneOf(c.action, CATALOG.execute_actions, "Execute action") };
      break;
    case "THRESHOLD": {
      if (nested) throw badRequest("THRESHOLD steps cannot be nested");
      const value = Number(c.value);
      if (typeof c.value === "boolean" || c.value === "" || c.value === null || !Number.isFinite(value)) throw badRequest("Threshold value must be a number");
      const lane = (k: string) => {
        const arr = c[k] ?? [];
        if (!Array.isArray(arr)) throw badRequest(`${k} must be an array`);
        return arr.map((s, i) => cleanStep(s, true, `${id}${k[0]}${i + 1}`));
      };
      config = {
        field: oneOf(c.field, CATALOG.threshold_fields, "Threshold field"),
        operator: oneOf(c.operator, CATALOG.threshold_operators, "Threshold operator"),
        value,
        true_label: String(c.true_label ?? ""),
        false_label: String(c.false_label ?? ""),
        true_steps: lane("true_steps"),
        false_steps: lane("false_steps"),
      };
      break;
    }
    case "APPROVAL": {
      const recipients = Array.isArray(c.recipients) ? c.recipients.map((r) => String(r).trim()).filter(Boolean) : [];
      if (!recipients.length) throw badRequest("Approval needs at least one recipient");
      const tiers = Number(c.tiers ?? 1);
      if (!Number.isInteger(tiers) || tiers < 1 || tiers > recipients.length) throw badRequest(`Approval tiers must be an integer from 1 to ${recipients.length}`);
      config = { message: String(c.message ?? ""), recipients, tiers };
      break;
    }
    case "NOTIFY":
      if (typeof c.recipient !== "string" || !c.recipient.trim()) throw badRequest("Notify needs a recipient");
      config = { recipient: c.recipient.trim(), template: String(c.template ?? "") };
      break;
  }
  if (nested && (type === "TRIGGER" || type === "THRESHOLD")) throw badRequest(`${type} is not allowed inside a threshold lane`);
  return { id, type, name, config };
}

export function cleanDefinition(body: Cfg): { name: string; description: string; steps: FlowStep[] } {
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 120) throw badRequest("name must be 1-120 characters");
  if (!Array.isArray(body.steps) || !body.steps.length) throw badRequest("steps must be a non-empty array");
  const steps = body.steps.map((s, i) => cleanStep(s, false, `s${i + 1}`));
  if (steps[0].type !== "TRIGGER" || steps.slice(1).some((s) => s.type === "TRIGGER")) throw badRequest("A flow needs exactly one TRIGGER step, as the first step");
  return { name: body.name.trim(), description: typeof body.description === "string" ? body.description : "", steps };
}

const defOf = (f: { name: string; description: string; steps: FlowStep[] }) => JSON.stringify([f.name, f.description, f.steps]);

export function seedFlows(): Flow[] {
  const t = nowIso();
  const base = { created_at: t, updated_at: t, updated_by: "system" };
  const approval: FlowStep = { id: "s4", type: "APPROVAL", name: "Approval", config: { message: "Approve {count} purchase order line(s), total {po_value}.", recipients: ["Operator"], tiers: 1 } };
  return [
    {
      id: "FLW-0001",
      name: "Shortage to purchase order",
      description: "Buyer flow over component shortages.",
      steps: [
        { id: "s1", type: "TRIGGER", name: "Trigger", config: { source: "component_shortages" } },
        { id: "s2", type: "GATHER", name: "Gather data", config: { data: ["bom", "projections"] } },
        { id: "s3", type: "ANALYZE", name: "Analyze", config: { method: "buy_recommendation" } },
        approval,
        { id: "s5", type: "EXECUTE", name: "Execute", config: { action: "create_po" } },
      ],
      status: "published",
      version: 1,
      last_simulation: { passed: true, version: 1, at: t, run_id: "seed" },
      ...base,
    },
    {
      id: "FLW-0002",
      name: "Late order reschedule",
      description: "Reschedules late production orders; large slips also notify.",
      steps: [
        { id: "s1", type: "TRIGGER", name: "Trigger", config: { source: "late_production_orders" } },
        { id: "s2", type: "GATHER", name: "Gather data", config: { data: ["capacity"] } },
        { id: "s3", type: "ANALYZE", name: "Analyze", config: { method: "reschedule_simulation" } },
        {
          id: "s4",
          type: "THRESHOLD",
          name: "Slip size",
          config: {
            field: "days_late",
            operator: "gt",
            value: 3,
            true_label: "Large slip",
            false_label: "Small slip",
            true_steps: [{ id: "s4t1", type: "NOTIFY", name: "Notify", config: { recipient: "Account Manager", template: "{count} order(s) late, worst {days_late} days." } }],
            false_steps: [],
          },
        },
        { ...approval, id: "s5" },
        { id: "s6", type: "EXECUTE", name: "Execute", config: { action: "reschedule_prod_order" } },
      ],
      status: "draft",
      version: 1,
      last_simulation: null,
      ...base,
    },
  ];
}

export const listFlows = (s: Store) => s.get<Flow[]>(KEYS.flows, seedFlows);
export function getFlow(s: Store, id: string): Flow {
  const f = listFlows(s).find((x) => x.id === id);
  if (!f) throw notFound(`Flow ${id} not found`);
  return f;
}

export function saveFlow(store: Store, body: Cfg, actor: string): Flow {
  const def = cleanDefinition(body);
  const id = typeof body.id === "string" && body.id ? body.id : null;
  const t = nowIso();
  if (id) getFlow(store, id);
  const flow = store.update<Flow[], Flow>(KEYS.flows, seedFlows, (flows) => {
    const cur = id ? flows.find((f) => f.id === id) : undefined;
    if (cur) {
      if (defOf(cur) !== defOf(def)) {
        cur.version += 1;
        cur.status = "draft";
      }
      Object.assign(cur, def, { updated_at: t, updated_by: actor });
      return cur;
    }
    const nf: Flow = { id: nextId(store, "flow", "FLW-"), ...def, status: "draft", version: 1, last_simulation: null, created_at: t, updated_at: t, updated_by: actor };
    flows.push(nf);
    return nf;
  });
  audit(store, actor, "flow.save", `${flow.id} v${flow.version} ${flow.name}`);
  return flow;
}

export function deleteFlow(store: Store, id: string, actor: string) {
  const f = getFlow(store, id);
  if (f.status === "published") throw conflict("A published flow cannot be deleted");
  store.update<Flow[]>(KEYS.flows, seedFlows, (flows) => void flows.splice(flows.findIndex((x) => x.id === id), 1));
  audit(store, actor, "flow.delete", `${id} ${f.name}`);
}

export function publishFlow(store: Store, id: string, actor: string): Flow {
  const f = getFlow(store, id);
  if (!f.last_simulation?.passed || f.last_simulation.version !== f.version) throw conflict("Publish requires a passed simulation of the current version");
  const out = store.update<Flow[], Flow>(KEYS.flows, seedFlows, (flows) => {
    const x = flows.find((y) => y.id === id)!;
    x.status = "published";
    x.updated_at = nowIso();
    x.updated_by = actor;
    return x;
  });
  audit(store, actor, "flow.publish", `${id} v${out.version}`);
  return out;
}

// ---------- engine ----------

const OPS: Record<string, (a: number, b: number) => boolean> = { gt: (a, b) => a > b, gte: (a, b) => a >= b, lt: (a, b) => a < b, lte: (a, b) => a <= b };

function vars(run: FlowRun, st: FlowState): Record<string, string> {
  const sum = (k: "po_value" | "quantity" | "net_need") => st.proposals.reduce((s, p) => s + p.metrics[k], 0);
  const first = st.proposals[0]?.context_data ?? {};
  const v: Record<string, string> = {
    flow_name: run.flow_name,
    count: String(st.proposals.length),
    po_value: String(Math.round(sum("po_value") * 100) / 100),
    quantity: String(sum("quantity")),
    net_need: String(sum("net_need")),
    days_late: String(Math.max(0, ...st.proposals.map((p) => p.metrics.days_late))),
  };
  for (const [k, val] of Object.entries(first)) if (typeof val === "string" || typeof val === "number") v[k] ??= String(val);
  return v;
}
const fill = (tpl: string, v: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);

function rec(run: FlowRun, step: FlowStep, status: FlowRunStep["status"], detail: string, actor = "system"): FlowRunStep {
  const t = nowIso();
  const r: FlowRunStep = { step_id: step.id ?? step.type, type: step.type, name: step.name, status, detail, actor, started_at: t, finished_at: status === "yellow" ? null : t };
  run.steps.push(r);
  return r;
}

function finish(run: FlowRun, status: FlowRun["status"]) {
  run.status = status;
  run.finished_at = nowIso();
}

function skipRest(run: FlowRun, queue: FlowStep[]) {
  for (const s of queue) rec(run, s, "skipped", "skipped");
  run.state!.queue = [];
}

/** Run queued steps until done, blocked on a human, or failed. */
function proceed(store: Store, run: FlowRun, actor: string) {
  const st = run.state!;
  const live = run.mode === "live";
  run.status = "running";
  while (st.queue.length) {
    const step = st.queue.shift()!;
    const c = step.config;
    const eng = ENGINE[st.source];
    const fail = (detail: string) => {
      rec(run, step, "red", detail);
      skipRest(run, st.queue);
      finish(run, "failed");
    };
    if (step.type === "TRIGGER") {
      st.source = String(c.source);
      st.trigger_count = ENGINE[st.source].run(store).length;
      rec(run, step, "green", `${st.trigger_count} item(s) match '${st.source}'.`);
      if (!st.trigger_count) {
        rec(run, { type: "NOTIFY", name: "Nothing to do", config: {} }, "green", "No matching items; remaining steps skipped.");
        skipRest(run, st.queue);
        finish(run, "completed");
        return;
      }
    } else if (step.type === "GATHER") {
      rec(run, step, "green", `Datasets read from local master data: ${((c.data as string[]) ?? []).join(", ") || "none"} (no live ERP).`);
    } else if (step.type === "ANALYZE") {
      if (c.method !== eng.method) return fail(`Method '${String(c.method)}' does not fit trigger '${st.source}' (expects '${eng.method}').`);
      st.proposals = eng.run(store);
      rec(run, step, "green", `${st.proposals.length} proposal(s) from the rule-based '${eng.method}' procedure.`);
    } else if (step.type === "THRESHOLD") {
      const field = String(c.field) as "po_value" | "quantity" | "days_late" | "net_need";
      const vals = st.proposals.map((p) => p.metrics[field]);
      const agg = field === "days_late" ? Math.max(0, ...vals) : vals.reduce((a, b) => a + b, 0);
      const hit = OPS[String(c.operator)](agg, Number(c.value));
      const lane = ((hit ? c.true_steps : c.false_steps) as FlowStep[]) ?? [];
      rec(run, step, "green", `${field} = ${agg} ${String(c.operator)} ${String(c.value)} → ${hit}; lane '${String((hit ? c.true_label : c.false_label) || (hit ? "Condition met" : "Otherwise"))}' (${lane.length} step(s)).`);
      st.queue.unshift(...lane);
    } else if (step.type === "APPROVAL") {
      const recipients = c.recipients as string[];
      if (!live) {
        rec(run, step, "green", `Simulated approval (${String(c.tiers)} tier(s)); no human involved.`, "simulation");
        st.approved_before_execute = true;
      } else {
        st.approval = step;
        st.tier = 1;
        rec(run, step, "yellow", `Waiting for tier 1 of ${String(c.tiers)} (${recipients[0]}).`);
        approvalItem(store, run, step, 1);
        run.status = "awaiting_hitl";
        return;
      }
    } else if (step.type === "EXECUTE") {
      if (!st.approved_before_execute) return fail("Blocked: no APPROVAL step before EXECUTE.");
      if (c.action !== eng.action) return fail(`Action '${String(c.action)}' does not fit trigger '${st.source}' (expects '${eng.action}').`);
      if (!live) {
        rec(run, step, "green", `Dry run: would ${eng.action} for ${st.proposals.length} proposal(s); nothing written.`, "simulation");
      } else {
        const results = st.proposals.map((p) => executeItem(store, p));
        const err = results.find((r) => typeof r.error === "string");
        if (err) return fail(`Execution failed: ${String(err.error)}`);
        rec(run, step, "green", `Executed '${eng.action}' for ${results.length} proposal(s): ${results.map((r) => String(r.po_number ?? r.applied ?? r.delivery)).join(", ")}.`, actor);
      }
    } else if (step.type === "NOTIFY") {
      rec(run, step, "green", `Recorded notification to ${String(c.recipient)} (not sent): ${fill(String(c.template ?? ""), vars(run, st))}`);
    }
  }
  finish(run, "completed");
}

function approvalItem(store: Store, run: FlowRun, step: FlowStep, tier: number) {
  const st = run.state!;
  const v = vars(run, st);
  const recipients = step.config.recipients as string[];
  addInboxItem(store, {
    agent_name: run.flow_name,
    action_type: "FLOW_APPROVAL",
    title: `Approval — ${run.flow_name} (tier ${tier})`,
    recommended_action: fill(String(step.config.message || "Approve to continue."), v),
    ai_confidence_score: 0.8,
    flow_run_id: run.id,
    context_data: {
      why: `Flow '${run.flow_name}' v${run.flow_version} is waiting for ${recipients[tier - 1]} (tier ${tier} of ${String(step.config.tiers)}).`,
      proposal: { proposals: st.proposals.length, po_value: Number(v.po_value), quantity: Number(v.quantity), net_need: Number(v.net_need), days_late: Number(v.days_late), tier, recipient: recipients[tier - 1] },
    },
  });
}

function flattenQueue(steps: FlowStep[]): FlowStep[] {
  return steps.map((s) => structuredClone(s));
}

function startRun(store: Store, flow: Flow, mode: "simulate" | "live", actor: string): FlowRun {
  const run: FlowRun = {
    id: nextId(store, "flowrun", "FR-"),
    flow_id: flow.id,
    flow_name: flow.name,
    flow_version: flow.version,
    mode,
    status: "running",
    started_at: nowIso(),
    finished_at: null,
    initiated_by: actor,
    steps: [],
    state: { queue: flattenQueue(flow.steps), proposals: [], source: "", tier: 0, approval: null, approved_before_execute: false, trigger_count: 0 },
  };
  proceed(store, run, actor);
  store.update<FlowRun[]>(KEYS.flowRuns, () => [], (d) => void d.unshift(run));
  return run;
}

export const publicRun = ({ state: _s, ...r }: FlowRun): Omit<FlowRun, "state"> => r;

export function simulateFlow(store: Store, id: string, actor: string) {
  const flow = getFlow(store, id);
  const run = startRun(store, flow, "simulate", actor);
  const passed = run.status === "completed";
  store.update<Flow[]>(KEYS.flows, seedFlows, (flows) => {
    flows.find((f) => f.id === id)!.last_simulation = { passed, version: flow.version, at: nowIso(), run_id: run.id };
  });
  audit(store, actor, "flow.simulate", `${id} v${flow.version} ${passed ? "passed" : "failed"}`);
  return publicRun(run);
}

export function runFlow(store: Store, id: string, actor: string) {
  const flow = getFlow(store, id);
  if (flow.status !== "published") throw conflict("Only published flows can run live");
  const run = startRun(store, flow, "live", actor);
  audit(store, actor, "flow.run", `${id} ${run.id} ${run.status}`);
  return publicRun(run);
}

/** A FLOW_APPROVAL inbox item was decided: continue, escalate to the next tier, or stop the run. */
export function onFlowDecision(store: Store, runId: string, approved: boolean, actor: string) {
  const run = listFlowRuns(store).find((r) => r.id === runId);
  if (!run || run.status !== "awaiting_hitl" || !run.state?.approval) return;
  const st = run.state;
  const step = st.approval!;
  const pending = [...run.steps].reverse().find((s) => s.status === "yellow")!;
  pending.finished_at = nowIso();
  pending.actor = actor;
  if (!approved) {
    pending.status = "red";
    pending.detail = `Rejected by ${actor} at tier ${st.tier}.`;
    skipRest(run, st.queue);
    finish(run, "rejected");
  } else {
    pending.status = "green";
    pending.detail = `Tier ${st.tier} approved by ${actor}.`;
    if (st.tier < Number(step.config.tiers)) {
      st.tier += 1;
      rec(run, step, "yellow", `Waiting for tier ${st.tier} of ${String(step.config.tiers)} (${(step.config.recipients as string[])[st.tier - 1]}).`);
      approvalItem(store, run, step, st.tier);
    } else {
      st.approval = null;
      st.approved_before_execute = true;
      proceed(store, run, actor);
    }
  }
  store.update<FlowRun[]>(KEYS.flowRuns, () => [], (d) => void d.splice(d.findIndex((r) => r.id === runId), 1, run));
}
