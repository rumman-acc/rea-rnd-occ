import { badRequest, conflict, notFound } from "@/server/http";
import { nowIso } from "@/server/clock";
import type { Store } from "@/server/store";
import { AGENTS, EXPERIENCE, KEYS, MARKETS, STYLES, audit, getConfig, listInbox } from "./core";
import { settleRun } from "./agents";
import { executeItem, revalidate, type Verdict } from "./executors";
import { onFlowDecision } from "./flows";
import type { AiConfig, AiSettings, InboxItem, Persona } from "./types";

type Body = Record<string, unknown>;

export function configView(store: Store) {
  return { agents: AGENTS, ...getConfig(store) };
}

const setConfig = (s: Store, fn: (c: AiConfig) => void) => s.update<AiConfig>(KEYS.config, () => getConfig(s), fn);

export function setSimulationMode(store: Store, body: Body, actor: string) {
  if (typeof body.enabled !== "boolean") throw badRequest("enabled must be true or false");
  setConfig(store, (c) => void (c.simulation_mode = body.enabled as boolean));
  audit(store, actor, "simulation_mode.set", body.enabled ? "SIMULATION" : "LIVE");
  return { simulation_mode: body.enabled };
}

export function updatePersona(store: Store, body: Body, actor: string): Persona {
  const next: Partial<Persona> = {};
  if (body.risk_tolerance !== undefined) {
    const r = Number(body.risk_tolerance);
    if (typeof body.risk_tolerance !== "number" || !Number.isFinite(r) || r < 0 || r > 1) throw badRequest("risk_tolerance must be a number from 0 to 1");
    next.risk_tolerance = r;
  }
  if (body.experience_level !== undefined) {
    if (typeof body.experience_level !== "string" || !EXPERIENCE.includes(body.experience_level)) throw badRequest(`experience_level must be one of: ${EXPERIENCE.join(", ")}`);
    next.experience_level = body.experience_level;
  }
  if (body.communication_style !== undefined) {
    if (typeof body.communication_style !== "string" || !STYLES.includes(body.communication_style)) throw badRequest(`communication_style must be one of: ${STYLES.join(", ")}`);
    next.communication_style = body.communication_style;
  }
  setConfig(store, (c) => void Object.assign(c.persona, next));
  audit(store, actor, "persona.update", JSON.stringify(next));
  return getConfig(store).persona;
}

export function updateSettings(store: Store, body: Body, actor: string): AiSettings {
  const next: Partial<AiSettings> = {};
  if (body.supply_market_risk_factor !== undefined) {
    if (typeof body.supply_market_risk_factor !== "string" || !MARKETS.includes(body.supply_market_risk_factor)) throw badRequest(`supply_market_risk_factor must be one of: ${MARKETS.join(", ")}`);
    next.supply_market_risk_factor = body.supply_market_risk_factor;
  }
  if (body.fulfillment_contingency_buffer_days !== undefined) {
    const d = body.fulfillment_contingency_buffer_days;
    if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 60) throw badRequest("fulfillment_contingency_buffer_days must be an integer from 0 to 60");
    next.fulfillment_contingency_buffer_days = d;
  }
  setConfig(store, (c) => void Object.assign(c.settings, next));
  audit(store, actor, "settings.update", JSON.stringify(next));
  return getConfig(store).settings;
}

const patch = <T>(store: Store, id: string, fn: (i: InboxItem) => T): T =>
  store.update<InboxItem[], T>(KEYS.inbox, () => [], (d) => fn(d.find((x) => x.id === id)!));

function find(store: Store, id: string): InboxItem {
  const i = listInbox(store).find((x) => x.id === id);
  if (!i) throw notFound(`Inbox item ${id} not found`);
  return i;
}

export function listItems(store: Store, pendingOnly: boolean) {
  return listInbox(store)
    .filter((i) => !pendingOnly || i.decision === "PENDING")
    .reverse();
}

export function decide(store: Store, id: string, body: Body, actor: string): InboxItem {
  const item = find(store, id);
  if (body.decision !== "APPROVED" && body.decision !== "REJECTED") throw badRequest("decision must be APPROVED or REJECTED");
  if (item.decision !== "PENDING") throw conflict(`Item ${id} was already decided`);
  const approved = body.decision === "APPROVED";
  const note = typeof body.note === "string" ? body.note : "";
  const mods = (body.modifications ?? {}) as { email?: { subject?: unknown; body?: unknown } };
  const sim = getConfig(store).simulation_mode;

  const out = patch(store, id, (i) => {
    if (approved && mods.email && i.context_data.email) {
      const e = i.context_data.email as Record<string, unknown>;
      if (typeof mods.email.subject === "string") e.subject = mods.email.subject;
      if (typeof mods.email.body === "string") e.body = mods.email.body;
    }
    i.decision = body.decision as "APPROVED" | "REJECTED";
    i.decision_note = note;
    i.decided_at = nowIso();
    i.decided_by = actor;
    return i;
  });
  audit(store, actor, `inbox.${approved ? "approve" : "reject"}`, `${id} ${item.title}${note ? ` — ${note}` : ""}${approved && mods.email ? " (email edited)" : ""}`);

  let result: InboxItem = out;
  if (item.action_type === "FLOW_APPROVAL") {
    if (item.flow_run_id) onFlowDecision(store, item.flow_run_id, approved, actor);
  } else if (approved) {
    const er = sim ? { simulated: true } : executeItem(store, out);
    result = patch(store, id, (i) => {
      i.execution_result = er;
      i.saved_plan = sim ? "SAVED" : null;
      return i;
    });
    audit(store, actor, sim ? "plan.save" : "action.execute", `${id} ${JSON.stringify(er)}`);
  }
  if (item.run_id) {
    const siblings = listInbox(store).filter((i) => i.run_id === item.run_id);
    if (siblings.every((i) => i.decision !== "PENDING")) settleRun(store, item.run_id, siblings.some((i) => i.decision === "APPROVED"));
  }
  return result;
}

// ---------- saved plans ----------

export const listPlans = (store: Store) => listInbox(store).filter((i) => i.saved_plan === "SAVED").reverse();

function plan(store: Store, id: string): InboxItem {
  const i = find(store, id);
  if (i.saved_plan !== "SAVED") throw notFound(`Saved plan ${id} not found`);
  return i;
}

export function validatePlan(store: Store, id: string, actor: string): Verdict {
  const i = plan(store, id);
  const v: Verdict = { ...revalidate(store, i), checked_at: nowIso() };
  patch(store, id, (x) => void (x.context_data.revalidation = v));
  audit(store, actor, "plan.validate", `${id} ${v.verdict}`);
  return v;
}

export function executePlan(store: Store, id: string, body: Body, actor: string): InboxItem {
  const i = plan(store, id);
  const force = body.force === true;
  const rv = i.context_data.revalidation as Verdict | undefined;
  if (!force && !rv) throw conflict("Validate the plan before executing it");
  if (!force && rv?.verdict === "obsolete") throw conflict("The plan is obsolete; discard it (or force)");
  const er = executeItem(store, i);
  const out = patch(store, id, (x) => {
    x.execution_result = er;
    x.saved_plan = "EXECUTED";
    return x;
  });
  audit(store, actor, "plan.execute", `${id} ${JSON.stringify(er)}${force ? " (forced)" : ""}`);
  return out;
}

export function discardPlan(store: Store, id: string, body: Body, actor: string): InboxItem {
  plan(store, id);
  const note = typeof body.note === "string" ? body.note : "";
  const out = patch(store, id, (x) => {
    x.saved_plan = "DISCARDED";
    return x;
  });
  audit(store, actor, "plan.discard", `${id}${note ? ` — ${note}` : ""}`);
  return out;
}
