import { appendAudit } from "@/server/audit";
import { badRequest } from "@/server/http";
import type { Store } from "@/server/store";
import { nowIso } from "@/server/clock";
import type { AgentRun, AiConfig, Flow, FlowRun, InboxItem } from "./types";

export const KEYS = {
  config: "ai:config",
  seq: "ai:seq",
  runs: "ai:runs",
  inbox: "ai:inbox",
  flows: "ai:flows",
  flowRuns: "ai:flow-runs",
} as const;

export const EXPERIENCE = ["Junior Expediter", "Senior Planner", "VP of Supply Chain"];
export const STYLES = ["Direct/Brief", "Diplomatic", "Data-Heavy"];
export const MARKETS = ["standard", "disrupted", "critical"];
export const MARKET_FACTOR: Record<string, number> = { standard: 1, disrupted: 1.25, critical: 1.5 };

export const AGENTS = [
  { name: "replenishment", label: "Replenishment Buyer", objective: "Find components projected short and propose vendor purchase orders sized to the persona's risk tolerance. (Simulated, rule-based.)" },
  { name: "production_sim", label: "Production Rescheduler", objective: "Find production orders that end after the promise date and propose compressed schedules. (Simulated, rule-based.)" },
  { name: "supplier_comms", label: "Supplier Comms", objective: "Draft expedite emails for overdue vendor PO lines. Nothing is sent. (Simulated, rule-based.)" },
  { name: "ctp_negotiator", label: "CTP Negotiator", objective: "Propose realistic promise dates for sales lines without a production order. (Simulated, rule-based.)" },
];

export const defaultConfig = (): AiConfig => ({
  persona: { risk_tolerance: 0.5, experience_level: "Senior Planner", communication_style: "Diplomatic" },
  settings: { supply_market_risk_factor: "standard", fulfillment_contingency_buffer_days: 2 },
  simulation_mode: true,
});

export const getConfig = (s: Store) => s.get<AiConfig>(KEYS.config, defaultConfig);

export function nextId(s: Store, kind: "run" | "item" | "flow" | "flowrun" | "po", prefix: string, width = 4): string {
  const n = s.update<Record<string, number>, number>(KEYS.seq, () => ({ flow: 2 }), (d) => (d[kind] = (d[kind] ?? 0) + 1));
  return `${prefix}${String(n).padStart(width, "0")}`;
}

export const audit = (s: Store, actor: string, action: string, detail = "") =>
  appendAudit(s, { source: "ai", actor, action, detail });

/** Human id: payload actor if a non-empty string, else the session actor. */
export const who = (payload: unknown, fallback: string): string => {
  const a = (payload as { actor?: unknown } | null)?.actor;
  return typeof a === "string" && a.trim() ? a.trim() : fallback;
};

export const listRuns = (s: Store) => s.get<AgentRun[]>(KEYS.runs, () => []);
export const listInbox = (s: Store) => s.get<InboxItem[]>(KEYS.inbox, () => []);
export const listFlowRuns = (s: Store) => s.get<FlowRun[]>(KEYS.flowRuns, () => []);

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
}
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const stamp = nowIso;

export function str(v: unknown, field: string, max = 200): string {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw badRequest(`${field} must be a non-empty string up to ${max} characters`);
  return v;
}

export type { Flow };

export function addInboxItem(
  s: Store,
  i: Pick<InboxItem, "agent_name" | "action_type" | "title" | "recommended_action" | "ai_confidence_score" | "context_data"> & { run_id?: string | null; flow_run_id?: string | null },
): InboxItem {
  const item: InboxItem = {
    id: nextId(s, "item", "ITM-"),
    run_id: i.run_id ?? null,
    flow_run_id: i.flow_run_id ?? null,
    agent_name: i.agent_name,
    action_type: i.action_type,
    title: i.title,
    recommended_action: i.recommended_action,
    ai_confidence_score: i.ai_confidence_score,
    context_data: i.context_data,
    decision: "PENDING",
    decision_note: "",
    decided_at: null,
    decided_by: null,
    execution_result: null,
    saved_plan: null,
    created_at: nowIso(),
  };
  s.update<InboxItem[]>(KEYS.inbox, () => [], (d) => void d.push(item));
  return item;
}
