// Client-side shapes of the /api/ai responses (our design; see spec/ai-cockpit.md).

export interface Agent {
  name: string;
  label: string;
  objective: string;
}
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
  agents: Agent[];
  persona: Persona;
  settings: AiSettings;
  simulation_mode: boolean;
}
export interface AgentRun {
  run_id: string;
  agent_name: string;
  status: string;
  paused: boolean;
  notice: string | null;
  current_message: string;
  steps: { at: string; message: string; status: string }[];
  progress_pct: number;
  started_at: string;
}
export interface Verdict {
  verdict: "still_valid" | "changed" | "obsolete";
  summary: string;
  checked_at: string;
}
export type Ctx = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface InboxItem {
  id: string;
  agent_name: string;
  action_type: string;
  title: string;
  recommended_action: string;
  ai_confidence_score: number;
  context_data: Ctx;
  decision: "PENDING" | "APPROVED" | "REJECTED";
  decision_note: string;
  decided_at: string | null;
  execution_result: Ctx | null;
  created_at: string;
}
export type StepType = "TRIGGER" | "GATHER" | "ANALYZE" | "THRESHOLD" | "APPROVAL" | "EXECUTE" | "NOTIFY";
export interface FlowStep {
  id?: string;
  type: StepType;
  name: string;
  config: Ctx;
}
export interface Flow {
  id: string;
  name: string;
  description: string;
  steps: FlowStep[];
  status: "draft" | "published";
  version: number;
  last_simulation: { passed: boolean; version: number } | null;
}
export interface Catalog {
  trigger_sources: string[];
  analyze_methods: string[];
  execute_actions: string[];
  threshold_fields: string[];
  threshold_operators: string[];
}
export interface FlowRunStep {
  step_id: string;
  type: string;
  name: string;
  status: string;
  detail: string;
  actor: string;
  started_at: string | null;
}
export interface FlowRun {
  id: string;
  flow_id: string;
  flow_name: string;
  flow_version: number;
  mode: "simulate" | "live";
  status: string;
  started_at: string;
  finished_at: string | null;
  initiated_by: string;
  steps: FlowRunStep[];
}
