"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { aiApi } from "./api";
import { FlowRunView, STEP_KIND } from "./FlowRunView";
import type { Catalog, Ctx, Flow, FlowRun, FlowStep, StepType } from "./types";
import "./ai.css";

/** Process modeler: edit, simulate, publish and delete agent flows. Reusable (spec §9). */
export interface FlowBuilderProps {
  /** Human id sent as `actor` on save/simulate/publish. */
  operator: string;
  /** Called after a flow was published. */
  onPublished?: () => void;
}

type Path = (number | string)[];
interface Draft {
  id: string | null;
  name: string;
  description: string;
  steps: FlowStep[];
}

const KINDS: StepType[] = ["GATHER", "ANALYZE", "THRESHOLD", "APPROVAL", "EXECUTE", "NOTIFY"];
const DATASETS = ["bom", "projections", "po_receipts", "capacity", "vendor_stats"];
const OP_LABEL: Record<string, string> = { gt: ">", gte: "≥", lt: "<", lte: "≤" };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

function defaultConfig(t: StepType): Ctx {
  switch (t) {
    case "APPROVAL":
      return { message: "Approve to continue.", recipients: ["Operator"], tiers: 1 };
    case "EXECUTE":
      return { action: "create_po" };
    case "ANALYZE":
      return { method: "buy_recommendation" };
    case "GATHER":
      return { data: ["projections"] };
    case "NOTIFY":
      return { recipient: "Account Manager", template: "FYI: {so_number}" };
    case "THRESHOLD":
      return { field: "po_value", operator: "gt", value: 10000, true_label: "Variant A", false_label: "Variant B", true_steps: [], false_steps: [] };
    default:
      return { source: "component_shortages" };
  }
}

const newDraft = (): Draft => ({
  id: null,
  name: "New agent",
  description: "",
  steps: [
    { type: "TRIGGER", name: "Trigger", config: { source: "component_shortages" } },
    { type: "GATHER", name: "Gather data", config: { data: ["projections"] } },
    { type: "ANALYZE", name: "Analyze", config: { method: "buy_recommendation" } },
    { type: "APPROVAL", name: "Approval", config: defaultConfig("APPROVAL") },
    { type: "EXECUTE", name: "Execute", config: { action: "create_po" } },
  ],
});

function stepAt(d: Draft, p: Path): FlowStep | null {
  if (p.length === 1) return d.steps[p[0] as number] ?? null;
  const lane = (d.steps[p[0] as number]?.config[p[1] as string] as FlowStep[] | undefined) ?? [];
  return lane[p[2] as number] ?? null;
}

export function FlowBuilder({ operator, onPublished }: FlowBuilderProps) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [sel, setSel] = useState<Path | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [simRun, setSimRun] = useState<FlowRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback((f: Flow) => {
    const d: Draft = { id: f.id, name: f.name, description: f.description, steps: clone(f.steps) };
    setDraft(d);
    setBaseline(JSON.stringify(d));
    setSel(null);
    setSimRun(null);
    setError(null);
  }, []);

  const load = useCallback(
    async (keep = false) => {
      const r = await aiApi.flows();
      setFlows(r.flows);
      setCatalog(r.catalog);
      return r.flows;
    },
    [],
  );

  useEffect(() => {
    load()
      .then((fl) => fl[0] && open(fl[0]))
      .catch((e) => setError(String(e)));
  }, [load, open]);

  const current = flows.find((f) => f.id === draft?.id) ?? null;
  const dirty = !!draft && JSON.stringify(draft) !== baseline;
  const canPublish = !!current && !dirty && current.status !== "published" && !!current.last_simulation?.passed && current.last_simulation.version === current.version;

  const edit = (fn: (d: Draft) => void) => {
    if (!draft) return;
    const d = clone(draft);
    fn(d);
    setDraft(d);
  };

  const insert = (after: Path | null, type: StepType) => {
    const step: FlowStep = { type, name: STEP_KIND[type], config: defaultConfig(type) };
    edit((d) => {
      if (!after) d.steps.push(step);
      else if (after.length === 1) d.steps.splice((after[0] as number) + 1, 0, step);
      else {
        const lane = (d.steps[after[0] as number].config[after[1] as string] as FlowStep[] | undefined) ?? [];
        lane.splice((after[2] as number) + 1, 0, step);
        d.steps[after[0] as number].config[after[1] as string] = lane;
      }
    });
  };

  async function run(kind: string, fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  const persist = async () => {
    const f = await aiApi.saveFlow({ id: draft!.id, name: draft!.name, description: draft!.description, steps: draft!.steps }, operator);
    await load();
    open(f);
    return f;
  };

  const simulate = () =>
    run("simulate", async () => {
      const f = dirty || !draft!.id ? await persist() : current!;
      const r = await aiApi.simulateFlow(f.id, operator);
      setSimRun(r.run);
      await load();
    });

  const selected = draft && sel ? stepAt(draft, sel) : null;

  return (
    <div className="ai-modeler">
      <Card title="Agent flows" bodyClassName="ai-flowlist">
        <button className="btn btn--primary ai-wide" onClick={() => { setDraft(newDraft()); setBaseline(""); setSel(null); setSimRun(null); }}>
          + New agent
        </button>
        {flows.map((f) => (
          <button key={f.id} className={`ai-flowbtn${draft?.id === f.id ? " ai-flowbtn--on" : ""}`} onClick={() => open(f)}>
            <b>{f.name}</b>
            <span className="ai-row">
              <span className={`pill pill--${f.status === "published" ? "green" : "gray"}`}>{f.status}</span>
              <span className="ai-muted">v{f.version}</span>
              {f.last_simulation?.passed && f.last_simulation.version === f.version && <span title="simulation passed">✓</span>}
            </span>
          </button>
        ))}
      </Card>

      <div className="stack">
        {!draft ? (
          <Card title="Process definition">
            <p className="ai-muted">Select a flow or create a new agent.</p>
            {error && <p className="ai-bad">{error}</p>}
          </Card>
        ) : (
          <>
            <Card
              title="Process definition"
              actions={
                <span className="ai-row">
                  {current && (
                    <span className={`pill pill--${current.status === "published" ? "green" : "gray"}`}>
                      {current.status} · v{current.version}
                    </span>
                  )}
                  {dirty && <span className="pill pill--yellow">unsaved edits</span>}
                </span>
              }
            >
              <div className="grid-2 ai-gap">
                <input className="input" aria-label="Flow name" value={draft.name} onChange={(e) => edit((d) => void (d.name = e.target.value))} />
                <input className="input" aria-label="Flow description" placeholder="Description" value={draft.description} onChange={(e) => edit((d) => void (d.description = e.target.value))} />
              </div>
              <Strip steps={draft.steps} base={[]} sel={sel} onSelect={setSel} onAdd={(after, t) => insert(after, t)} allowThreshold />
              {draft.steps.map((s, i) =>
                s.type === "THRESHOLD" ? (
                  <div key={s.id ?? i} className="ai-lanes">
                    {(["true_steps", "false_steps"] as const).map((k) => (
                      <div key={k}>
                        <div className="ai-lane-title">{k === "true_steps" ? `▲ ${s.config.true_label || "Condition met"}` : `▼ ${s.config.false_label || "Otherwise"}`}</div>
                        <Strip steps={(s.config[k] as FlowStep[]) ?? []} base={[i, k]} sel={sel} onSelect={setSel} onAdd={(_a, t) => insert(_a ?? [i, k, -1], t)} allowThreshold={false} />
                      </div>
                    ))}
                  </div>
                ) : null,
              )}
              {selected && catalog && sel && (
                <StepEditor
                  step={selected}
                  catalog={catalog}
                  onChange={(patch) =>
                    edit((d) => {
                      const t = stepAt(d, sel)!;
                      if (patch.name !== undefined) t.name = patch.name;
                      if (patch.config) t.config = { ...t.config, ...patch.config };
                    })
                  }
                  onRemove={() => {
                    edit((d) => {
                      if (sel.length === 1) d.steps.splice(sel[0] as number, 1);
                      else (d.steps[sel[0] as number].config[sel[1] as string] as FlowStep[]).splice(sel[2] as number, 1);
                    });
                    setSel(null);
                  }}
                  onMove={(delta) => {
                    edit((d) => {
                      const arr = sel.length === 1 ? d.steps : (d.steps[sel[0] as number].config[sel[1] as string] as FlowStep[]);
                      const i = sel.length === 1 ? (sel[0] as number) : (sel[2] as number);
                      const j = i + delta;
                      if (j >= 0 && j < arr.length) [arr[i], arr[j]] = [arr[j], arr[i]];
                    });
                    setSel(null);
                  }}
                />
              )}
              {error && <p className="ai-bad" role="alert">{error}</p>}
              <div className="toolbar ai-actions">
                <button className="btn" disabled={busy !== null || !dirty} onClick={() => void run("save", async () => void (await persist()))}>
                  Save draft
                </button>
                <button className="btn ai-purple" disabled={busy !== null} onClick={() => void simulate()}>
                  Simulate (dry-run on local master data)
                </button>
                <button
                  className="btn btn--green"
                  disabled={busy !== null || !canPublish}
                  onClick={() =>
                    void run("publish", async () => {
                      await aiApi.publishFlow(draft.id!, operator);
                      await load();
                      onPublished?.();
                    })
                  }
                >
                  Publish to Cockpit
                </button>
                {current && !canPublish && current.status !== "published" && <span className="ai-muted">publish unlocks after a passed simulation of the current version</span>}
                <span className="toolbar__spacer" />
                <button
                  className="btn btn--danger"
                  disabled={busy !== null || current?.status === "published"}
                  onClick={() =>
                    void run("delete", async () => {
                      if (draft.id) await aiApi.deleteFlow(draft.id);
                      setDraft(null);
                      setSimRun(null);
                      await load();
                    })
                  }
                >
                  Delete
                </button>
              </div>
            </Card>
            {simRun && (
              <Card
                title={`Simulation result — ${simRun.flow_name}`}
                actions={
                  <span className={`pill pill--${simRun.status === "completed" ? "green" : "red"}`}>
                    {simRun.status === "completed" ? "PASSED — publish unlocked" : "FAILED — fix and re-simulate"}
                  </span>
                }
              >
                <FlowRunView run={simRun} />
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Strip({ steps, base, sel, onSelect, onAdd, allowThreshold }: { steps: FlowStep[]; base: (number | string)[]; sel: Path | null; onSelect: (p: Path) => void; onAdd: (after: Path | null, t: StepType) => void; allowThreshold: boolean }) {
  const [menu, setMenu] = useState<number | null>(null);
  const kinds = KINDS.filter((k) => allowThreshold || k !== "THRESHOLD");
  const Menu = ({ after, idx }: { after: Path | null; idx: number }) =>
    menu === idx ? (
      <span className="ai-menu">
        {kinds.map((k) => (
          <button key={k} onClick={() => { onAdd(after, k); setMenu(null); }}>
            {STEP_KIND[k]}
          </button>
        ))}
      </span>
    ) : null;
  return (
    <div className="ai-strip">
      {steps.map((s, i) => {
        const p: Path = base.length ? [base[0], base[1], i] : [i];
        const on = JSON.stringify(sel) === JSON.stringify(p);
        return (
          <span key={s.id ?? `${i}-${s.type}`} className="ai-row">
            <button className={`ai-chip ai-chip--${s.type}${on ? " ai-chip--sel" : ""}`} onClick={() => onSelect(p)}>
              <span className="ai-chip__kind">{STEP_KIND[s.type]}</span>
              {s.name}
            </button>
            <span className="ai-rel">
              <button className="ai-plus" title="Add step after" aria-label={`Add step after ${s.name}`} onClick={() => setMenu(menu === i ? null : i)}>
                +
              </button>
              <Menu after={p} idx={i} />
            </span>
            {i < steps.length - 1 && <span className="ai-arrow">→</span>}
          </span>
        );
      })}
      {steps.length === 0 && (
        <span className="ai-rel">
          <button className="ai-plus ai-plus--wide" onClick={() => setMenu(menu === -1 ? null : -1)}>
            + add step
          </button>
          <Menu after={null} idx={-1} />
        </span>
      )}
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`field${full ? " ai-full" : ""}`}>
      {label}
      {children}
    </label>
  );
}

function StepEditor({ step, catalog, onChange, onRemove, onMove }: { step: FlowStep; catalog: Catalog; onChange: (p: { name?: string; config?: Ctx }) => void; onRemove: () => void; onMove: (d: number) => void }) {
  const c = step.config;
  const cfg = (config: Ctx) => onChange({ config });
  const sel = (key: string, list: string[], label: string) => (
    <Field label={label}>
      <select className="select" value={String(c[key] ?? "")} onChange={(e) => cfg({ [key]: e.target.value })}>
        {list.map((v) => (
          <option key={v} value={v}>
            {v.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </Field>
  );
  const recipients = (c.recipients as string[]) ?? [];
  return (
    <div className="ai-editor">
      <div className="ai-row">
        <span className="pill pill--blue">{STEP_KIND[step.type]}</span>
        <input className="input" aria-label="Step name" value={step.name} onChange={(e) => onChange({ name: e.target.value })} />
        <span className="ai-spacer" />
        <button className="btn btn--small" title="Move earlier" onClick={() => onMove(-1)}>↑</button>
        <button className="btn btn--small" title="Move later" onClick={() => onMove(1)}>↓</button>
        {step.type !== "TRIGGER" && (
          <button className="btn btn--small" title="Remove step" onClick={onRemove}>✕</button>
        )}
      </div>
      <div className="grid-2 ai-gap">
        {step.type === "TRIGGER" && sel("source", catalog.trigger_sources, "Trigger source")}
        {step.type === "ANALYZE" && sel("method", catalog.analyze_methods, "Analysis engine")}
        {step.type === "EXECUTE" && sel("action", catalog.execute_actions, "Action")}
        {step.type === "GATHER" && (
          <Field label="Datasets (local master data)">
            <span className="ai-row ai-wrap">
              {DATASETS.map((d) => {
                const on = ((c.data as string[]) ?? []).includes(d);
                return (
                  <button key={d} className={`btn btn--small${on ? " btn--primary" : ""}`} aria-pressed={on} onClick={() => cfg({ data: on ? ((c.data as string[]) ?? []).filter((x) => x !== d) : [...((c.data as string[]) ?? []), d] })}>
                    {d}
                  </button>
                );
              })}
            </span>
          </Field>
        )}
        {step.type === "THRESHOLD" && (
          <>
            {sel("field", catalog.threshold_fields, "Value field")}
            <Field label="Condition">
              <span className="ai-row">
                <select className="select" aria-label="Operator" value={String(c.operator ?? "gt")} onChange={(e) => cfg({ operator: e.target.value })}>
                  {catalog.threshold_operators.map((o) => (
                    <option key={o} value={o}>
                      {OP_LABEL[o] ?? o}
                    </option>
                  ))}
                </select>
                <input className="input" type="number" aria-label="Threshold value" value={Number(c.value ?? 0)} onChange={(e) => cfg({ value: Number(e.target.value) })} />
              </span>
            </Field>
            <Field label="Label — condition met">
              <input className="input" value={String(c.true_label ?? "")} onChange={(e) => cfg({ true_label: e.target.value })} />
            </Field>
            <Field label="Label — otherwise">
              <input className="input" value={String(c.false_label ?? "")} onChange={(e) => cfg({ false_label: e.target.value })} />
            </Field>
          </>
        )}
        {step.type === "APPROVAL" && (
          <>
            <Field label="Approval message ({placeholders} from the proposal)" full>
              <textarea className="textarea" rows={3} value={String(c.message ?? "")} onChange={(e) => cfg({ message: e.target.value })} />
            </Field>
            <Field label="Recipient hierarchy (comma-separated, tier order)">
              <input className="input" value={recipients.join(", ")} onChange={(e) => cfg({ recipients: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
            </Field>
            <Field label={`Approval tiers (1–${recipients.length || 1})`}>
              <input className="input" type="number" min={1} max={recipients.length || 1} value={Number(c.tiers ?? 1)} onChange={(e) => cfg({ tiers: Number(e.target.value) })} />
            </Field>
          </>
        )}
        {step.type === "NOTIFY" && (
          <>
            <Field label="Recipient">
              <input className="input" value={String(c.recipient ?? "")} onChange={(e) => cfg({ recipient: e.target.value })} />
            </Field>
            <Field label="Message template ({placeholders})" full>
              <textarea className="textarea" rows={2} value={String(c.template ?? "")} onChange={(e) => cfg({ template: e.target.value })} />
            </Field>
          </>
        )}
      </div>
    </div>
  );
}
