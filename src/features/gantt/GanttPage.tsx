"use client";

import { FlaskConical } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { formatMoney } from "@/domain/format";
import { createOrder, getSchedule, rescheduleOrder, type ScheduleOrder, type SimInput } from "@/features/production/api";
import { EvidenceNotice, errText, useLoad } from "@/features/production/useLoad";
import { usePlan } from "@/state/PlanState";
import "@/features/production/production.css";
import "./gantt.css";

const DAY_PX = 16;
const DAY_MS = 86400000;
const t = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const days = (a: string, b: string) => Math.round((t(b) - t(a)) / DAY_MS);
const add = (iso: string, n: number) => new Date(t(iso) + n * DAY_MS).toISOString().slice(0, 10);
const monday = (iso: string) => add(iso, -((new Date(t(iso)).getUTCDay() + 6) % 7));
const healthClass = (o: ScheduleOrder) => (o.health ? `gantt-bar--${o.health}` : "gantt-bar--none");

export function GanttPage() {
  const { plan, effective, simMode, setSimMode, simOverrides, simNewOrders, addSimOverride, setSimNewOrders, simBusy, discardSim, refresh } = usePlan();
  const sim: SimInput | undefined = useMemo(
    () => (simMode && (simOverrides.length > 0 || simNewOrders.length > 0) ? { overrides: simOverrides, new_orders: simNewOrders } : undefined),
    [simMode, simOverrides, simNewOrders],
  );
  const sched = useLoad(() => getSchedule(sim), [sim]);
  const [selected, setSelected] = useState<string | null>(null);
  const [edit, setEdit] = useState({ start: "", end: "" });
  const [err, setErr] = useState<string | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  const orders = useMemo(
    () => [...(sched.data?.orders ?? [])].filter((o) => o.status !== "Finished").sort((a, b) => a.start_date.localeCompare(b.start_date) || a.po_number.localeCompare(b.po_number)),
    [sched.data],
  );
  const sel = orders.find((o) => o.po_number === selected) ?? null;
  useEffect(() => {
    if (sel) setEdit({ start: sel.start_date, end: sel.end_date });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const today = sched.data?.today ?? "";
  const frame = useMemo(() => {
    if (!orders.length || !today) return null;
    const dates = orders.flatMap((o) => [o.start_date, o.end_date, ...(o.delivery_date ? [o.delivery_date.slice(0, 10)] : [])]);
    const start = monday([today, ...dates].reduce((m, d) => (d < m ? d : m)));
    const last = [today, ...dates].reduce((m, d) => (d > m ? d : m));
    const total = days(start, last) + 8;
    const weeks = Array.from({ length: Math.ceil(total / 7) }, (_, i) => add(start, i * 7));
    return { start, total, weeks };
  }, [orders, today]);

  const changes = simOverrides.length + simNewOrders.length;
  const k0 = plan?.kpis;
  const k1 = effective.kpis;

  function applyEdit() {
    if (!sel) return;
    if (!edit.start || !edit.end || edit.end < edit.start) return setErr("End date must not be before the start date.");
    setErr(null);
    void addSimOverride({ po_number: sel.po_number, start_date: edit.start, end_date: edit.end });
  }
  const shiftEdit = (n: number) => edit.start && edit.end && setEdit({ start: add(edit.start, n), end: add(edit.end, n) });

  async function applyAll() {
    setErr(null);
    try {
      const simNames = new Set(simNewOrders.map((n) => n.name));
      for (const o of simOverrides) {
        if (simNames.has(o.po_number)) continue; // folded into the new order below
        const cur = orders.find((x) => x.po_number === o.po_number);
        await rescheduleOrder(o.po_number, String(o.start_date ?? cur?.start_date), String(o.end_date ?? cur?.end_date));
      }
      for (const n of simNewOrders) {
        const o = simOverrides.find((x) => x.po_number === n.name);
        await createOrder({
          fg_item_no: String(n.fg_item_no),
          quantity: Number(n.quantity),
          so_number: n.so_number ? String(n.so_number) : undefined,
          start_date: String(o?.start_date ?? n.start_date),
          end_date: String(o?.end_date ?? n.end_date),
        });
      }
      setApplied(`Applied ${changes} change(s) to production orders.`);
      setConfirmApply(false);
      discardSim();
      await refresh();
    } catch (e) {
      setErr(errText(e));
    }
  }

  return (
    <div>
      <PageHeader
        title="Schedule & Simulate"
        sub="drag-free what-if: change dates, add orders, see KPIs move — nothing is saved until applied"
        actions={
          simMode ? (
            <button type="button" className="btn btn--danger" onClick={discardSim}>Stop simulation</button>
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => { setApplied(null); setSimMode(true); }}>
              <FlaskConical size={13} aria-hidden="true" /> Start simulation
            </button>
          )
        }
      />
      <EvidenceNotice />
      {applied && <div className="prd-saved prd-section" role="status">{applied}</div>}
      {sched.error && <div className="notice notice--bad prd-section">{sched.error}</div>}
      {err && <div className="notice notice--bad prd-section" role="alert">{err}</div>}

      <div className="prd-section">
        <Card title="Production timeline" actions={simMode ? <span className="pill pill--yellow">Simulating{simBusy ? "…" : ""}</span> : undefined}>
          {sched.loading && !sched.data && <div className="loading" role="status">Loading schedule…</div>}
          {sched.data && !frame && <div className="empty">No production orders.</div>}
          {frame && (
            <div className="gantt" role="group" aria-label="Production timeline">
              <div className="gantt__labels">
                <div className="gantt__head">Order</div>
                {orders.map((o) => (
                  <button key={o.po_number} type="button" className={`gantt__label${selected === o.po_number ? " is-selected" : ""}`} onClick={() => setSelected(o.po_number)}>
                    <span className="mono strong">{o.po_number}</span> <span className="muted">{o.fg_item_no}</span>
                    {o.simulated && <span className="pill pill--purple">sim</span>}
                  </button>
                ))}
              </div>
              <div className="gantt__scroll">
                <div className="gantt__canvas" style={{ width: frame.total * DAY_PX }}>
                  <div className="gantt__head">
                    {frame.weeks.map((w) => (
                      <span key={w} className="gantt__week" style={{ width: 7 * DAY_PX }}>{w.slice(5)}</span>
                    ))}
                  </div>
                  <div className="gantt__today" style={{ left: days(frame.start, today) * DAY_PX }} title={`Today ${today}`} />
                  {orders.map((o) => {
                    const left = days(frame.start, o.start_date) * DAY_PX;
                    const width = (days(o.start_date, o.end_date) + 1) * DAY_PX;
                    return (
                      <div key={o.po_number} className="gantt__row">
                        <button
                          type="button"
                          className={`gantt-bar ${healthClass(o)}${o.changed || o.simulated ? " gantt-bar--changed" : ""}${selected === o.po_number ? " is-selected" : ""}`}
                          style={{ left, width }}
                          title={`${o.po_number}: ${o.start_date} → ${o.end_date}${o.delivery_date ? ` (SO due ${o.delivery_date.slice(0, 10)})` : ""}`}
                          aria-label={`Bar ${o.po_number}`}
                          onClick={() => setSelected(o.po_number)}
                        >
                          <span className="gantt-bar__progress" style={{ width: `${o.pct_complete}%` }} />
                        </button>
                        {o.delivery_date && <span className="gantt__due" style={{ left: days(frame.start, o.delivery_date.slice(0, 10)) * DAY_PX + DAY_PX / 2 }} title={`SO delivery ${o.delivery_date.slice(0, 10)}`}>◆</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          <p className="muted">Bar colour: green safe, amber watch, red at risk, grey unlinked. ◆ = sales order delivery date.</p>
        </Card>
      </div>

      {sel && (
        <div className="prd-section">
          <Card title={`Edit ${sel.po_number}`}>
            <div className="prd-form">
              <label className="field">Start<input className="input" type="date" aria-label="Start date" value={edit.start} disabled={!simMode} onChange={(e) => setEdit({ ...edit, start: e.target.value })} /></label>
              <label className="field">End<input className="input" type="date" aria-label="End date" value={edit.end} disabled={!simMode} onChange={(e) => setEdit({ ...edit, end: e.target.value })} /></label>
              <button type="button" className="btn btn--outline" disabled={!simMode} onClick={() => shiftEdit(-7)}>−1 week</button>
              <button type="button" className="btn btn--outline" disabled={!simMode} onClick={() => shiftEdit(7)}>+1 week</button>
              <button type="button" className="btn btn--primary" disabled={!simMode} onClick={applyEdit}>Apply reschedule</button>
            </div>
            {!simMode && <p className="muted">Start the simulation to change dates.</p>}
            <p className="muted">
              {sel.customer_name ?? "No linked sales order"} · buffer {sel.buffer_days === null ? "—" : `${sel.buffer_days}d`} · status {sel.status}
            </p>
          </Card>
        </div>
      )}

      {simMode && sched.data && (
        <div className="prd-section">
          <NewOrderCard fgItems={sched.data.fg_items} sos={sched.data.unlinked_sos} existing={simNewOrders} onChange={setSimNewOrders} />
        </div>
      )}

      <div className="prd-section">
        <Card title="Impact">
          <table className="dt" aria-label="Impact">
            <thead><tr><th>KPI</th><th className="right">Base</th><th className="right">Simulated</th></tr></thead>
            <tbody>
              {k0 && k1 && (
                <>
                  <tr><td>On-Time Coverage</td><td className="num">{k0.on_time_pct}%</td><td className="num">{k1.on_time_pct}%</td></tr>
                  <tr><td>PO Linkage</td><td className="num">{k0.linked_pct}%</td><td className="num">{k1.linked_pct}%</td></tr>
                  <tr><td>Critical Materials</td><td className="num">{k0.critical_items}</td><td className="num">{k1.critical_items}</td></tr>
                  <tr><td>Revenue at Risk</td><td className="num">{formatMoney(k0.revenue_at_risk)}</td><td className="num">{formatMoney(k1.revenue_at_risk)}</td></tr>
                </>
              )}
            </tbody>
          </table>
          {simMode && changes > 0 && (
            <div className="toolbar prd-section">
              {confirmApply ? (
                <>
                  <span className="notice notice--warn">This changes real production orders.</span>
                  <button type="button" className="btn btn--danger" onClick={applyAll}>Confirm apply</button>
                  <button type="button" className="btn btn--outline" onClick={() => setConfirmApply(false)}>Cancel</button>
                </>
              ) : (
                <button type="button" className="btn btn--outline" onClick={() => setConfirmApply(true)}>Apply to production orders</button>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function NewOrderCard({ fgItems, sos, existing, onChange }: {
  fgItems: Array<{ item_no: string; description: string }>;
  sos: string[];
  existing: Array<{ name: string; [k: string]: unknown }>;
  onChange: (o: Array<{ name: string; [k: string]: unknown }>) => Promise<void>;
}) {
  const [f, setF] = useState({ fg: fgItems[0]?.item_no ?? "", qty: "1", so: "", start: "", end: "" });
  const [err, setErr] = useState<string | null>(null);
  let n = existing.length + 1;
  while (existing.some((o) => o.name === `SIM-${n}`)) n++;

  function add() {
    const qty = Number(f.qty);
    if (!f.fg || !(qty > 0) || !f.start || !f.end) return setErr("Item, a positive quantity, start and end are required.");
    if (f.end < f.start) return setErr("End date must not be before the start date.");
    setErr(null);
    void onChange([...existing, { name: `SIM-${n}`, fg_item_no: f.fg, quantity: qty, ...(f.so ? { so_number: f.so } : {}), start_date: f.start, end_date: f.end }]);
  }
  return (
    <Card title="New simulated order">
      <div className="prd-form">
        <label className="field">Finished good
          <select className="select" aria-label="New order item" value={f.fg} onChange={(e) => setF({ ...f, fg: e.target.value })}>
            {fgItems.map((i) => <option key={i.item_no} value={i.item_no}>{i.item_no}</option>)}
          </select>
        </label>
        <label className="field">Quantity<input className="input input--narrow" aria-label="New order quantity" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></label>
        <label className="field">Sales order
          <select className="select" aria-label="New order sales order" value={f.so} onChange={(e) => setF({ ...f, so: e.target.value })}>
            <option value="">none</option>
            {sos.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field">Start<input className="input" type="date" aria-label="New order start" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></label>
        <label className="field">End<input className="input" type="date" aria-label="New order end" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></label>
        <button type="button" className="btn btn--primary" onClick={add}>Add order {`SIM-${n}`}</button>
      </div>
      {err && <div className="notice notice--bad prd-section" role="alert">{err}</div>}
      {existing.length > 0 && (
        <ul className="prd-section">
          {existing.map((o) => (
            <li key={o.name}>
              <span className="mono strong">{o.name}</span> {String(o.fg_item_no)} × {String(o.quantity)} {String(o.start_date)} → {String(o.end_date)}{" "}
              <button type="button" className="btn btn--small" aria-label={`Remove ${o.name}`} onClick={() => void onChange(existing.filter((x) => x.name !== o.name))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
