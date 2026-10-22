"use client";

import { useState } from "react";
import { Card } from "@/components/Card";
import { KpiCard } from "@/components/KpiCard";
import { PageHeader } from "@/components/PageHeader";
import {
  addAdjustment, deleteAdjustment, getCapacityDemand, getCapacityPlan, getRouting, getSchedule, getWorkCenters, putHeadcounts, putRouting, runScenario,
  type CapacityPlan, type ScenarioResult, type WorkCenter,
} from "@/features/production/api";
import { EvidenceNotice, errText, useLoad } from "@/features/production/useLoad";
import "@/features/production/production.css";

type Tab = "load" | "demand" | "scenario" | "setup";
type Gran = "week" | "month";
const TABS: Array<[Tab, string]> = [["load", "Load"], ["demand", "Demand"], ["scenario", "Scenario"], ["setup", "Setup"]];

export function CapacityPage() {
  const [gran, setGran] = useState<Gran>("week");
  const [tab, setTab] = useState<Tab>("load");
  const plan = useLoad(() => getCapacityPlan(gran), [gran]);
  const wcs = useLoad(getWorkCenters, []);
  const reloadAll = async () => { await plan.reload(); await wcs.reload(); };

  return (
    <div>
      <PageHeader
        title="Capacity"
        sub={`${wcs.data?.length ?? plan.data?.work_centers.length ?? 0} work centers · demand vs capacity by week/month`}
        actions={
          <div className="prd-switch" role="group" aria-label="Granularity">
            {(["week", "month"] as const).map((g) => (
              <button key={g} type="button" className={gran === g ? "is-active" : ""} aria-pressed={gran === g} onClick={() => setGran(g)}>
                {g === "week" ? "Week" : "Month"}
              </button>
            ))}
          </div>
        }
      />
      <EvidenceNotice />
      <div className="tabs prd-section" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "tab tab--active" : "tab"} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {plan.error && <div className="notice notice--bad prd-error">{plan.error}</div>}
      {plan.loading && !plan.data && <div className="loading" role="status">Loading capacity…</div>}
      {plan.data && tab === "load" && <LoadTab plan={plan.data} />}
      {tab === "demand" && <DemandTab gran={gran} />}
      {tab === "scenario" && wcs.data && <ScenarioTab gran={gran} centers={wcs.data} onApplied={reloadAll} />}
      {tab === "setup" && wcs.data && plan.data && <SetupTab centers={wcs.data} plan={plan.data} onChanged={reloadAll} />}
    </div>
  );
}

function Matrix({ plan, label }: { plan: CapacityPlan; label?: string }) {
  return (
    <div className="table-scroll">
      <table className="dt" aria-label={label ?? "Capacity load"}>
        <thead>
          <tr>
            <th>Work center</th>
            {plan.periods.map((p) => <th key={p.key} className="right">{p.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {plan.work_centers.map((w) => (
            <tr key={w.code}>
              <td className="strong">{w.name} <span className="muted">({w.headcount})</span></td>
              {w.rows.map((r) => (
                <td key={r.period} className={`prd-heat prd-heat--${r.status}`} title={`${r.demand_hours} h demand / ${r.available_hours} h available`} data-status={r.status}>
                  {r.utilization_pct === null ? "n/a" : `${r.utilization_pct}%`}
                </td>
              ))}
            </tr>
          ))}
          {plan.work_centers.length === 0 && <tr><td className="empty">No work centers.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function LoadTab({ plan }: { plan: CapacityPlan }) {
  return (
    <>
      <div className="prd-cards">
        <KpiCard label="Overloaded cells" value={plan.summary.overloaded} sub="work center × period over 100%" tone={plan.summary.overloaded > 0 ? "red" : "green"} />
        <KpiCard label="Peak utilization" value={`${plan.summary.peak_utilization_pct}%`} sub="highest cell" tone={plan.summary.peak_utilization_pct > 100 ? "red" : plan.summary.peak_utilization_pct > 85 ? "amber" : "green"} />
        <KpiCard label="Work centers" value={plan.work_centers.length} sub="in the plan" tone="blue" />
        <KpiCard label="Periods" value={plan.periods.length} sub={plan.granularity === "week" ? "weeks from this week" : "months from this month"} tone="blue" />
      </div>
      <section className="card"><Matrix plan={plan} /></section>
      <p className="muted">Utilization = remaining demand hours ÷ available hours (working days from today). Green ≤ 85%, amber ≤ 100%, red above.</p>
    </>
  );
}

function DemandTab({ gran }: { gran: Gran }) {
  const d = useLoad(() => getCapacityDemand(gran), [gran]);
  if (d.error) return <div className="notice notice--bad">{d.error}</div>;
  if (!d.data) return <div className="loading" role="status">Loading demand…</div>;
  return (
    <section className="card">
      <div className="table-scroll">
        <table className="dt" aria-label="Demand by order">
          <thead>
            <tr>
              <th>PO #</th><th>Item</th><th>Status</th><th className="right">Remaining</th>
              {d.data.periods.map((p) => <th key={p.key} className="right">{p.label}</th>)}
              <th className="right">Total h</th>
            </tr>
          </thead>
          <tbody>
            {d.data.orders.map((o) => (
              <tr key={o.po_number}>
                <td className="mono strong">{o.po_number}</td>
                <td className="mono">{o.item_no}</td>
                <td>{o.status}</td>
                <td className="num">{o.remaining_units}</td>
                {d.data!.periods.map((p) => <td key={p.key} className="num">{o.hours[p.key] ?? ""}</td>)}
                <td className="num strong">{o.total_hours}</td>
              </tr>
            ))}
            {d.data.orders.length === 0 && <tr><td colSpan={6} className="empty">No production demand in the horizon.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ScenarioTab({ gran, centers, onApplied }: { gran: Gran; centers: WorkCenter[]; onApplied: () => Promise<void> }) {
  const sched = useLoad(() => getSchedule(), []);
  const [hc, setHc] = useState<Record<string, string>>(() => Object.fromEntries(centers.map((w) => [w.code, String(w.headcount)])));
  const [shift, setShift] = useState<Record<string, string>>({});
  const [no, setNo] = useState({ fg: "", qty: "1", start: "", end: "" });
  const [res, setRes] = useState<ScenarioResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const open = (sched.data?.orders ?? []).filter((o) => o.status !== "Finished");
  const headcounts = () => Object.fromEntries(Object.entries(hc).map(([k, v]) => [k, Number(v)]));

  async function run() {
    setErr(null);
    setNote(null);
    try {
      const po_shifts = Object.fromEntries(Object.entries(shift).filter(([, v]) => v !== "" && Number(v) !== 0).map(([k, v]) => [k, Number(v)]));
      const new_orders = no.fg ? [{ name: "SCN-1", fg_item_no: no.fg, quantity: Number(no.qty), start_date: no.start, end_date: no.end }] : [];
      setRes(await runScenario({ granularity: gran, headcounts: headcounts(), po_shifts, po_quantities: {}, new_orders, po_dates: {} }));
    } catch (e) {
      setErr(errText(e));
    }
  }
  async function apply() {
    setErr(null);
    try {
      await putHeadcounts(headcounts());
      await onApplied();
      setNote("Headcounts saved.");
    } catch (e) {
      setErr(errText(e));
    }
  }

  return (
    <div className="stack">
      <Card title="Scenario inputs">
        <div className="prd-form">
          {centers.map((w) => (
            <label key={w.code} className="field">
              {w.name} headcount
              <input className="input input--narrow" inputMode="numeric" value={hc[w.code] ?? ""} onChange={(e) => setHc({ ...hc, [w.code]: e.target.value })} />
            </label>
          ))}
        </div>
        <h3 className="prd-section" style={{ fontSize: 12.5 }}>Shift orders (days, negative = earlier)</h3>
        <div className="prd-form">
          {open.map((o) => (
            <label key={o.po_number} className="field">
              {o.po_number}
              <input className="input input--narrow" inputMode="numeric" aria-label={`Shift ${o.po_number}`} value={shift[o.po_number] ?? ""} placeholder="0" onChange={(e) => setShift({ ...shift, [o.po_number]: e.target.value })} />
            </label>
          ))}
        </div>
        <h3 className="prd-section" style={{ fontSize: 12.5 }}>Hypothetical order (optional)</h3>
        <div className="prd-form">
          <label className="field">Finished good
            <select className="select" aria-label="Scenario item" value={no.fg} onChange={(e) => setNo({ ...no, fg: e.target.value })}>
              <option value="">none</option>
              {(sched.data?.fg_items ?? []).map((i) => <option key={i.item_no} value={i.item_no}>{i.item_no}</option>)}
            </select>
          </label>
          <label className="field">Quantity<input className="input input--narrow" aria-label="Scenario quantity" value={no.qty} onChange={(e) => setNo({ ...no, qty: e.target.value })} /></label>
          <label className="field">Start<input className="input" type="date" aria-label="Scenario start" value={no.start} onChange={(e) => setNo({ ...no, start: e.target.value })} /></label>
          <label className="field">End<input className="input" type="date" aria-label="Scenario end" value={no.end} onChange={(e) => setNo({ ...no, end: e.target.value })} /></label>
        </div>
        <div className="toolbar prd-section">
          <button type="button" className="btn btn--primary" onClick={run}>Run scenario</button>
          <button type="button" className="btn btn--outline" onClick={apply}>Apply headcounts</button>
          {note && <span className="prd-saved" role="status">{note}</span>}
        </div>
        {err && <div className="notice notice--bad" role="alert">{err}</div>}
      </Card>
      {res && (
        <>
          <div className="notice notice--warn">Scenario — nothing is saved.</div>
          <div className="prd-cards" data-testid="scenario-delta">
            <KpiCard label="Overloaded before" value={res.delta.overloaded_before} sub="baseline" tone="amber" />
            <KpiCard label="Overloaded after" value={res.delta.overloaded_after} sub="scenario" tone={res.delta.overloaded_after > res.delta.overloaded_before ? "red" : "green"} />
            <KpiCard label="Peak before" value={`${res.delta.peak_before}%`} sub="baseline" tone="blue" />
            <KpiCard label="Peak after" value={`${res.delta.peak_after}%`} sub="scenario" tone="blue" />
          </div>
          <Card title="Baseline"><Matrix plan={res.baseline} label="Baseline load" /></Card>
          <Card title="Scenario"><Matrix plan={res.scenario} label="Scenario load" /></Card>
        </>
      )}
    </div>
  );
}

function SetupTab({ centers, plan, onChanged }: { centers: WorkCenter[]; plan: CapacityPlan; onChanged: () => Promise<void> }) {
  const routing = useLoad(getRouting, []);
  const [hc, setHc] = useState<Record<string, string>>(() => Object.fromEntries(centers.map((w) => [w.code, String(w.headcount)])));
  const [grid, setGrid] = useState<Record<string, Record<string, string>> | null>(null);
  const [adj, setAdj] = useState({ work_center: centers[0]?.code ?? "", start_date: "", end_date: "", hours_per_day: "8", reason: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const view = routing.data;
  const cells = grid ?? (view ? Object.fromEntries(view.items.map((i) => [i.item_no, Object.fromEntries(view.work_centers.map((c) => [c, String(view.models[i.item_no]?.[c] ?? 0)]))])) : {});
  const ok = (text: string) => setMsg({ ok: true, text });
  const fail = (e: unknown) => setMsg({ ok: false, text: errText(e) });

  return (
    <div className="stack">
      {msg && <div className={msg.ok ? "prd-saved" : "notice notice--bad"} role={msg.ok ? "status" : "alert"}>{msg.text}</div>}
      <Card title="Headcounts">
        <div className="prd-form">
          {centers.map((w) => (
            <label key={w.code} className="field">{w.name}
              <input className="input input--narrow" inputMode="numeric" aria-label={`Headcount ${w.code}`} value={hc[w.code] ?? ""} onChange={(e) => setHc({ ...hc, [w.code]: e.target.value })} />
            </label>
          ))}
          <button type="button" className="btn btn--primary" onClick={async () => {
            try { await putHeadcounts(Object.fromEntries(Object.entries(hc).map(([k, v]) => [k, Number(v)]))); await onChanged(); ok("Headcounts saved."); } catch (e) { fail(e); }
          }}>Save headcounts</button>
        </div>
      </Card>
      <Card title="Routing times (hours per unit)">
        {view && (
          <div className="table-scroll">
            <table className="dt" aria-label="Routing times">
              <thead><tr><th>Model</th>{view.work_centers.map((c) => <th key={c} className="right">{c}</th>)}</tr></thead>
              <tbody>
                {view.items.map((i) => (
                  <tr key={i.item_no}>
                    <td className="mono strong">{i.item_no}</td>
                    {view.work_centers.map((c) => (
                      <td key={c} className="num">
                        <input className="input input--narrow" inputMode="decimal" aria-label={`${i.item_no} ${c} hours`} value={cells[i.item_no]?.[c] ?? ""}
                          onChange={(e) => setGrid({ ...cells, [i.item_no]: { ...cells[i.item_no], [c]: e.target.value } })} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {routing.error && <div className="notice notice--bad">{routing.error}</div>}
        <div className="toolbar prd-section">
          <button type="button" className="btn btn--primary" onClick={async () => {
            try {
              await putRouting(Object.fromEntries(Object.entries(cells).map(([m, row]) => [m, Object.fromEntries(Object.entries(row).map(([c, v]) => [c, Number(v)]))])));
              await routing.reload(); await onChanged(); setGrid(null); ok("Routing times saved.");
            } catch (e) { fail(e); }
          }}>Save routing times</button>
        </div>
      </Card>
      <Card title="Capacity adjustments">
        <div className="table-scroll">
          <table className="dt" aria-label="Adjustments">
            <thead><tr><th>#</th><th>Work center</th><th>From</th><th>To</th><th className="right">Hours / day</th><th>Reason</th><th /></tr></thead>
            <tbody>
              {plan.adjustments.map((a) => (
                <tr key={a.id}>
                  <td>{a.id}</td><td>{a.work_center}</td><td>{a.start_date}</td><td>{a.end_date}</td><td className="num">{a.hours_per_day}</td><td>{a.reason}</td>
                  <td><button type="button" className="btn btn--small" aria-label={`Delete adjustment ${a.id}`} onClick={async () => {
                    try { await deleteAdjustment(a.id); await onChanged(); ok("Adjustment deleted."); } catch (e) { fail(e); }
                  }}>Delete</button></td>
                </tr>
              ))}
              {plan.adjustments.length === 0 && <tr><td colSpan={7} className="empty">No adjustments.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="prd-form prd-section">
          <label className="field">Work center
            <select className="select" aria-label="Adjustment work center" value={adj.work_center} onChange={(e) => setAdj({ ...adj, work_center: e.target.value })}>
              {centers.map((w) => <option key={w.code} value={w.code}>{w.code}</option>)}
            </select>
          </label>
          <label className="field">From<input className="input" type="date" aria-label="Adjustment from" value={adj.start_date} onChange={(e) => setAdj({ ...adj, start_date: e.target.value })} /></label>
          <label className="field">To<input className="input" type="date" aria-label="Adjustment to" value={adj.end_date} onChange={(e) => setAdj({ ...adj, end_date: e.target.value })} /></label>
          <label className="field">Hours per day (±)<input className="input input--narrow" aria-label="Adjustment hours" value={adj.hours_per_day} onChange={(e) => setAdj({ ...adj, hours_per_day: e.target.value })} /></label>
          <label className="field">Reason<input className="input" aria-label="Adjustment reason" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} /></label>
          <button type="button" className="btn btn--primary" onClick={async () => {
            try {
              await addAdjustment({ work_center: adj.work_center, start_date: adj.start_date, end_date: adj.end_date, hours_per_day: Number(adj.hours_per_day), reason: adj.reason });
              await onChanged(); ok("Adjustment added.");
            } catch (e) { fail(e); }
          }}>Add adjustment</button>
        </div>
      </Card>
      <p className="muted">Labor rates are edited on the Product Costing page.</p>
    </div>
  );
}
