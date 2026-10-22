import { del, get, post, put, qs } from "@/lib/api/request";
import type { AgentRun, AiConfig, AiSettings, Catalog, Flow, FlowRun, FlowStep, InboxItem, Persona, Verdict } from "./types";

export const aiApi = {
  config: () => get<AiConfig>("/api/ai/config"),
  setSimulationMode: (enabled: boolean) => put<{ simulation_mode: boolean }>("/api/ai/simulation-mode", { enabled }),
  putPersona: (p: Persona) => put<Persona>("/api/ai/persona", p),
  putSettings: (s: AiSettings) => put<AiSettings>("/api/ai/settings", s),
  runs: () => get<AgentRun[]>("/api/ai/runs"),
  /** Advance simulated runs one stage and return them (the cockpit's poll). */
  tickRuns: () => post<AgentRun[]>("/api/ai/runs/tick"),
  runAgent: async (name: string, actor: string) => {
    let token = "";
    try {
      token = (await get<{ token?: string }>("/api/rag/token")).token ?? "";
    } catch {
      // the token is optional
    }
    return post<AgentRun>(`/api/ai/agents/${encodeURIComponent(name)}/run`, { user_token: token, actor });
  },
  controlRun: (id: string, action: "pause" | "resume" | "cancel", actor: string) =>
    post<AgentRun>(`/api/ai/runs/${encodeURIComponent(id)}/${action}`, { actor }),
  inbox: () => get<InboxItem[]>("/api/ai/inbox"),
  decide: (id: string, decision: "APPROVED" | "REJECTED", note: string, modifications: object, actor: string) =>
    post<InboxItem>(`/api/ai/inbox/${encodeURIComponent(id)}/decide`, { decision, note, modifications, actor }),
  savedPlans: () => get<InboxItem[]>("/api/ai/saved-plans"),
  validatePlan: (id: string) => post<Verdict>(`/api/ai/saved-plans/${encodeURIComponent(id)}/validate`, {}),
  executePlan: (id: string, force = false) => post<InboxItem>(`/api/ai/saved-plans/${encodeURIComponent(id)}/execute`, { force }),
  discardPlan: (id: string, note = "") => post<InboxItem>(`/api/ai/saved-plans/${encodeURIComponent(id)}/discard`, { note }),
  flows: () => get<{ flows: Flow[]; catalog: Catalog }>("/api/ai/flows"),
  saveFlow: (f: { id: string | null; name: string; description: string; steps: FlowStep[] }, actor: string) =>
    put<Flow>("/api/ai/flows", { ...f, actor }),
  deleteFlow: (id: string) => del<{ ok: boolean }>(`/api/ai/flows/${encodeURIComponent(id)}`),
  simulateFlow: (id: string, actor: string) => post<{ run: FlowRun }>(`/api/ai/flows/${encodeURIComponent(id)}/simulate`, { actor }),
  publishFlow: (id: string, actor: string) => post<Flow>(`/api/ai/flows/${encodeURIComponent(id)}/publish`, { actor }),
  runFlow: (id: string, actor: string) => post<{ run: FlowRun }>(`/api/ai/flows/${encodeURIComponent(id)}/run`, { actor }),
  flowRuns: (flowId?: string) => get<FlowRun[]>(`/api/ai/flow-runs${qs({ flow_id: flowId })}`),
};
