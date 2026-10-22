// M-AI types. All shapes are our own design (spec/ai-cockpit.md); only field names read by the page are evidenced.

export type ActionType = "CREATE_PO" | "RESCHEDULE_PROD_ORDER" | "CHANGE_SO_DATE" | "EMAIL_SUPPLIER" | "FLOW_APPROVAL";
export type RunStatus = "INITIALIZING" | "GATHERING_DATA" | "SIMULATING" | "AWAITING_HITL" | "EXECUTED" | "REJECTED";

export interface Persona {
  risk_tolerance: number;
  experience_level: string;
  communication_style: string;
}
export interface AiSettings {
  supply_market_risk_factor: string;
  fulfillment_contingency_buffer_days: number;
}
export interface AiConfig {
  persona: Persona;
  settings: AiSettings;
  simulation_mode: boolean;
}

export interface RunStep {
  at: string;
  message: string;
  status: string;
}
export interface AgentRun {
  run_id: string;
  agent_name: string;
  status: RunStatus;
  paused: boolean;
  notice: string | null;
  current_message: string;
  steps: RunStep[];
  progress_pct: number;
  started_at: string;
  finished_at: string | null;
  initiated_by: string;
}

export interface InboxItem {
  id: string;
  run_id: string | null;
  flow_run_id: string | null;
  agent_name: string;
  action_type: ActionType;
  title: string;
  recommended_action: string;
  ai_confidence_score: number;
  context_data: Record<string, unknown>;
  decision: "PENDING" | "APPROVED" | "REJECTED";
  decision_note: string;
  decided_at: string | null;
  decided_by: string | null;
  execution_result: Record<string, unknown> | null;
  saved_plan: "SAVED" | "EXECUTED" | "DISCARDED" | null;
  created_at: string;
}

/** What an agent procedure proposes; becomes an inbox item. `metrics` feed flow thresholds. */
export interface Proposal {
  action_type: ActionType;
  title: string;
  recommended_action: string;
  ai_confidence_score: number;
  context_data: Record<string, unknown>;
  metrics: { po_value: number; quantity: number; days_late: number; net_need: number };
}

export interface FlowStep {
  id?: string;
  type: "TRIGGER" | "GATHER" | "ANALYZE" | "THRESHOLD" | "APPROVAL" | "EXECUTE" | "NOTIFY";
  name: string;
  config: Record<string, unknown>;
}
export interface Flow {
  id: string;
  name: string;
  description: string;
  steps: FlowStep[];
  status: "draft" | "published";
  version: number;
  last_simulation: { passed: boolean; version: number; at: string; run_id: string } | null;
  created_at: string;
  updated_at: string;
  updated_by: string;
}
export interface FlowRunStep {
  step_id: string;
  type: string;
  name: string;
  status: "green" | "yellow" | "red" | "running" | "pending" | "skipped";
  detail: string;
  actor: string;
  started_at: string | null;
  finished_at: string | null;
}
export interface FlowRun {
  id: string;
  flow_id: string;
  flow_name: string;
  flow_version: number;
  mode: "simulate" | "live";
  status: "running" | "awaiting_hitl" | "completed" | "failed" | "rejected";
  started_at: string;
  finished_at: string | null;
  initiated_by: string;
  steps: FlowRunStep[];
  /** Engine state, not returned by the API. */
  state?: FlowState;
}
export interface FlowState {
  queue: FlowStep[];
  proposals: Proposal[];
  source: string;
  tier: number;
  approval: FlowStep | null;
  approved_before_execute: boolean;
  trigger_count: number;
}
