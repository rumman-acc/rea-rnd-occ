import { badRequest, conflict, notFound } from "@/server/http";
import { nowIso } from "@/server/clock";
import type { Store } from "@/server/store";
import { AGENTS, KEYS, addInboxItem, audit, getConfig, listRuns, nextId } from "./core";
import { AGENT_PROCEDURES } from "./proposals";
import type { AgentRun, RunStatus } from "./types";

const ACTIVE: RunStatus[] = ["INITIALIZING", "GATHERING_DATA", "SIMULATING"];
export const isActive = (r: AgentRun) => ACTIVE.includes(r.status);

function step(run: AgentRun, message: string, status: string = run.status) {
  run.steps.push({ at: nowIso(), message, status });
  run.current_message = message;
}

export function startRun(store: Store, name: string, actor: string): AgentRun {
  const agent = AGENTS.find((a) => a.name === name);
  if (!agent) throw notFound(`Unknown agent '${name}'`);
  if (listRuns(store).some((r) => r.agent_name === name && isActive(r))) throw conflict(`Agent '${name}' already has an active run`);
  const cfg = getConfig(store);
  const market = cfg.settings.supply_market_risk_factor;
  const run: AgentRun = {
    run_id: nextId(store, "run", "RUN-"),
    agent_name: name,
    status: "INITIALIZING",
    paused: false,
    notice: market === "standard" ? null : `Supply market risk is '${market}': lead times and order sizes are padded.`,
    current_message: "",
    steps: [],
    progress_pct: 10,
    started_at: nowIso(),
    finished_at: null,
    initiated_by: actor,
  };
  step(run, `${agent.label} initializing (simulated, rule-based; no AI model)…`);
  store.update<AgentRun[]>(KEYS.runs, () => [], (d) => void d.unshift(run));
  audit(store, actor, "agent.run", `${name} ${run.run_id}`);
  return run;
}

/** Polling-driven progress: each call moves every unpaused active run one stage (REQ-AI-AGT-003). */
export function listRunsAndTick(store: Store): AgentRun[] {
  store.update<AgentRun[]>(KEYS.runs, () => [], (runs) => {
    for (const run of runs) {
      if (!isActive(run) || run.paused) continue;
      if (run.status === "INITIALIZING") {
        run.status = "GATHERING_DATA";
        run.progress_pct = 40;
        step(run, "Gathering master data: sales lines, BOM, stock, vendor PO lines…");
      } else if (run.status === "GATHERING_DATA") {
        run.status = "SIMULATING";
        run.progress_pct = 70;
        step(run, "Applying rules with the saved persona and global variables…");
      } else {
        const proposals = (AGENT_PROCEDURES[run.agent_name] ?? (() => []))(store);
        const label = AGENTS.find((a) => a.name === run.agent_name)?.label ?? run.agent_name;
        if (!proposals.length) {
          run.status = "EXECUTED";
          run.progress_pct = 100;
          run.finished_at = nowIso();
          step(run, "Nothing to propose.");
        } else {
          for (const p of proposals) addInboxItem(store, { ...p, agent_name: run.agent_name, run_id: run.run_id });
          run.status = "AWAITING_HITL";
          run.progress_pct = 90;
          step(run, `${label} proposed ${proposals.length} action(s); waiting for a human decision.`);
        }
      }
    }
  });
  return listRuns(store);
}

export function controlRun(store: Store, id: string, action: string, actor: string): AgentRun {
  if (!["pause", "resume", "cancel"].includes(action)) throw badRequest(`Unknown action '${action}'`);
  const found = listRuns(store).find((r) => r.run_id === id);
  if (!found) throw notFound(`Run ${id} not found`);
  if (!isActive(found)) throw conflict(`Run ${id} is not active`);
  if (action === "pause" && found.paused) throw conflict("Run is already paused");
  if (action === "resume" && !found.paused) throw conflict("Run is not paused");
  const run = store.update<AgentRun[], AgentRun>(KEYS.runs, () => [], (runs) => {
    const r = runs.find((x) => x.run_id === id)!;
    if (action === "pause") {
      r.paused = true;
      step(r, `Paused by ${actor}.`);
    } else if (action === "resume") {
      r.paused = false;
      step(r, `Resumed by ${actor}.`);
    } else {
      r.paused = false;
      r.status = "REJECTED";
      r.finished_at = nowIso();
      step(r, `Cancelled by ${actor}.`, "REJECTED");
    }
    return r;
  });
  audit(store, actor, `run.${action}`, id);
  return run;
}

/** Close an agent run when all of its items are decided. */
export function settleRun(store: Store, runId: string, anyApproved: boolean) {
  store.update<AgentRun[]>(KEYS.runs, () => [], (runs) => {
    const r = runs.find((x) => x.run_id === runId);
    if (!r) return;
    r.status = anyApproved ? "EXECUTED" : "REJECTED";
    r.progress_pct = 100;
    r.finished_at = nowIso();
    step(r, anyApproved ? "All actions decided; approved actions handled." : "All actions rejected.", r.status);
  });
}
