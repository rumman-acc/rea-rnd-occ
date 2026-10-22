"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { formatMoney, formatShortDate, formatUnits, todayIso } from "@/domain/format";
import { csvCell, download, errText, fmtPrice, Modal, Notice, Pill, Th, useOperator, useTable } from "@/features/pricing/ui";
import { ProjectionChart } from "@/features/supply/ProjectionChart";
import { useRuntime } from "@/runtime/runtime";
import { getProjection, getRecommendations, postPos, putPersona } from "./api";
import { HORIZON_OPTIONS, POSTURE_OPTIONS, type Persona, type PostResult, type Projection, type RecLine } from "./types";

interface Row extends RecLine {
  qty: number;
  price: number;
  dlv: string;
  selected: boolean;
  edited: boolean;
}

type Popup = { kind: "usedin" | "so" | "po"; line: Row } | null;

const OTHER = "__other__";
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function flagsOf(r: RecLine): string {
  if (r.suggested.expedite) return "expedite";
  if (r.engine_qty <= 0) return r.open_pos.length > 0 ? "expedite open po" : "no buy review";
  return r.suggested.flag_soon ? "soon" : "";
}

/** Tab 1: the buy cockpit. Recommendations are rule based and simulated locally (REQ-PUR-UI-014). */
export function BuyCockpit() {
  const rt = useRuntime();
  const operator = useOperator();
  const [persona, setPersona] = useState<Persona | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");
  const [posting, setPosting] = useState(false);
  const [results, setResults] = useState<PostResult[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [proj, setProj] = useState<Record<string, Projection | null>>({});
  const [popup, setPopup] = useState<Popup>(null);
  const [series, setSeries] = useState("");

  const load = useCallback((refresh = false, keep = false) => {
    if (!keep) setRows(null);
    getRecommendations(refresh)
      .then((r) => {
        setError("");
        setPersona(r.persona);
        setRows((prev) =>
          r.lines.map<Row>((l) => {
            const old = keep ? prev?.find((p) => p.item_no === l.item_no) : undefined;
            if (old?.edited) return { ...l, qty: old.qty, price: old.price, dlv: old.dlv, selected: old.selected, edited: true };
            return {
              ...l, qty: l.suggested.qty, price: l.suggested.price, dlv: l.suggested.delivery_date, edited: false,
              selected: old?.selected ?? (l.suggested.preselect && l.vendor_no !== "UNASSIGNED"),
            };
          }),
        );
      })
      .catch((e) => {
        setError(errText(e));
        if (!keep) setRows([]);
      });
  }, []);
  useEffect(() => load(), [load]);

  const edit = (item: string, change: Partial<Row>) => setRows((rs) => (rs ?? []).map((r) => (r.item_no === item ? { ...r, ...change, edited: true } : r)));
  const restore = (item: string) =>
    setRows((rs) => (rs ?? []).map((r) => (r.item_no === item ? { ...r, qty: r.suggested.qty, price: r.suggested.price, dlv: r.suggested.delivery_date, edited: false } : r)));

  const seriesCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      const s = r.series.filter(Boolean);
      for (const k of s.length ? s : [OTHER]) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].sort(([a], [b]) => (a === OTHER ? 1 : b === OTHER ? -1 : a.localeCompare(b)));
  }, [rows]);

  const scoped = useMemo(
    () => (rows ?? []).filter((r) => !series || (series === OTHER ? r.series.length === 0 : r.series.includes(series))),
    [rows, series],
  );
  const t = useTable(scoped, {
    status: { get: (r) => r.supply_status },
    item: { get: (r) => `${r.item_no} ${r.description}` },
    vendor: { get: (r) => `${r.vendor_name} ${r.vendor_no}` },
    qty: { get: (r) => r.qty, numeric: true, nofilter: true },
    price: { get: (r) => r.price, numeric: true, nofilter: true },
    delivery: { get: (r) => r.dlv },
    value: { get: (r) => r.qty * r.price, numeric: true, nofilter: true },
    flags: { get: (r) => flagsOf(r) },
  });

  const selected = (rows ?? []).filter((r) => r.selected);
  const total = sum(selected.map((r) => r.qty * r.price));
  const vendorCount = new Set(selected.map((r) => r.vendor_no)).size;

  function toggleProjection(r: Row) {
    const next = open === r.item_no ? null : r.item_no;
    setOpen(next);
    if (next && !(next in proj)) {
      getProjection(next, false)
        .then((p) => setProj((m) => ({ ...m, [next]: p })))
        .catch(() => setProj((m) => ({ ...m, [next]: null })));
    }
  }

  async function post() {
    if (!window.confirm(`Create ${vendorCount} purchase order(s) for ${selected.length} line(s), total ${formatMoney(total)}?\n\nSimulated: POs are written to the local demo connector as unreleased.`)) return;
    setPosting(true);
    try {
      const res = await postPos(
        operator,
        selected.map((r) => ({ item_no: r.item_no, vendor_no: r.vendor_no, vendor_name: r.vendor_name, qty: r.qty, price: r.price || null, delivery_date: r.dlv })),
      );
      setResults(res);
      const done = new Set(res.filter((x) => x.status === "created").flatMap((x) => x.lines.map((l) => l.item_no)));
      setRows((rs) => (rs ?? []).filter((r) => !done.has(r.item_no)));
      load(true, true);
    } catch (e) {
      setError(errText(e));
    } finally {
      setPosting(false);
    }
  }

  function exportCsv() {
    const out = ["Status,Item,Description,Vendor,VendorNo,Qty,UnitPrice,Delivery,LineValue,EngineQty,NetShortfall,OrderBy,OnOpenPOs,Flag"];
    for (const r of t.view) {
      out.push([r.supply_status, r.item_no, csvCell(r.description), csvCell(r.vendor_name), r.vendor_no, r.qty, r.price, r.dlv, (r.qty * r.price).toFixed(2), r.engine_qty, r.net_shortfall, r.order_by, sum(r.open_pos.map((p) => p.qty)), flagsOf(r)].join(","));
    }
    download(`buy-cockpit-${todayIso(rt)}.csv`, out);
  }

  if (rows === null) return <div className="muted" style={{ padding: "64px 0", textAlign: "center" }}>Computing buy recommendations…</div>;

  return (
    <div className="stack">
      <Notice tone="warn">
        Recommendations come from a fixed rule set (component balances, supply netting, vendor lead times, MOQ and the buyer persona). They are not produced by an AI model.
        Posting writes purchase orders to the local simulated connector only; no external system is contacted.
      </Notice>
      {error && <Notice tone="bad">{error}</Notice>}
      {persona && <PersonaCard persona={persona} onSaved={(p) => { setPersona(p); load(); }} onError={setError} />}
      {results && (
        <div className="stack" aria-label="Post results" style={{ gap: 8 }}>
          {results.map((r) => (
            <div key={r.id} className={`pu-strip ${r.status === "created" ? "pu-strip--ok" : "pu-strip--bad"}`}>
              {r.status === "created" ? (
                <>
                  <b>PO {r.po_number} created</b> — {r.vendor_name || r.vendor_no} · {formatMoney(r.amount ?? 0)} · first delivery {formatShortDate(r.delivery_date)} · {r.lines.length} line(s).{" "}
                  <span className="muted">Unreleased, in the local simulated connector.</span>
                </>
              ) : (
                <>
                  <b>PO for {r.vendor_name || r.vendor_no} failed</b> — <span className="mono">{r.error}</span>
                </>
              )}
            </div>
          ))}
          <div>
            <button className="btn btn--small" onClick={() => setResults(null)}>Dismiss confirmations</button>
          </div>
        </div>
      )}
      <Card
        title={`Buy Recommendations — ${t.view.length} of ${rows.length} red/yellow components`}
        bodyClassName="card__body--table"
        actions={
          <div className="pu-bar">
            <label className="muted">
              Series{" "}
              <select className="select" value={series} onChange={(e) => setSeries(e.target.value)} aria-label="Series">
                <option value="">All series ({rows.length})</option>
                {seriesCounts.map(([k, n]) => (
                  <option key={k} value={k}>
                    {k === OTHER ? "Other" : `${k} series`} ({n})
                  </option>
                ))}
              </select>
            </label>
            {series && <button className="btn btn--small" onClick={() => setSeries("")}>clear</button>}
            <button className="btn btn--small" onClick={exportCsv}>Export CSV</button>
          </div>
        }
      >
        <div className="table-scroll">
          <table className="dt">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox" aria-label="Select all visible lines" title="Select all VISIBLE lines"
                    checked={t.view.length > 0 && t.view.filter((r) => r.vendor_no !== "UNASSIGNED").every((r) => r.selected)}
                    onChange={(e) => {
                      const ids = new Set(t.view.map((r) => r.item_no));
                      setRows((rs) => (rs ?? []).map((r) => (ids.has(r.item_no) ? { ...r, selected: e.target.checked && r.vendor_no !== "UNASSIGNED" } : r)));
                    }}
                  />
                </th>
                <th />
                <Th t={t} id="status" label="Status" />
                <Th t={t} id="item" label="Item" />
                <Th t={t} id="vendor" label="Vendor" />
                <Th t={t} id="qty" label="Qty" right />
                <Th t={t} id="price" label="Unit Price" right />
                <Th t={t} id="delivery" label="Delivery" />
                <Th t={t} id="value" label="Value" right />
                <th>AI Suggestion</th>
                <Th t={t} id="flags" label="Flags" />
              </tr>
            </thead>
            <tbody>
              {t.view.map((r) => (
                <Fragment key={r.item_no}>
                  <tr className={r.suggested.expedite ? "pu-row-expedite" : undefined} style={{ whiteSpace: "nowrap" }}>
                    <td>
                      <input type="checkbox" aria-label={`Select ${r.item_no}`} checked={r.selected} disabled={r.vendor_no === "UNASSIGNED"} onChange={(e) => setRows((rs) => (rs ?? []).map((x) => (x.item_no === r.item_no ? { ...x, selected: e.target.checked } : x)))} />
                    </td>
                    <td>
                      <button className="btn btn--small" aria-label={`${open === r.item_no ? "Hide" : "Show"} details for ${r.item_no}`} aria-expanded={open === r.item_no} title="Show item details: demand, open POs, projection" onClick={() => toggleProjection(r)}>
                        {open === r.item_no ? "▾" : "▸"}
                      </button>
                    </td>
                    <td>
                      <span className={`pu-dot pu-dot--${r.supply_status}`} role="img" aria-label={r.supply_status === "red" ? "Shortfall" : "Medium risk"} title={r.supply_status === "red" ? "Shortfall (red, as in the Supply Explorer)" : "Medium risk (yellow, as in the Supply Explorer)"} />
                    </td>
                    <td title={`${r.item_no} — ${r.description}\n${r.rationale}`}>
                      <span className="mono" style={{ fontWeight: 700 }}>{r.item_no}</span>{" "}
                      <button className="pill pill--blue" style={{ border: 0, cursor: "pointer" }} title={`Used in ${r.demand_detail.length} finished good(s)`} onClick={() => setPopup({ kind: "usedin", line: r })}>
                        used in {r.demand_detail.length}
                      </button>{" "}
                      <span className="muted">{r.description}</span>
                    </td>
                    <td title={r.vendor_name}>
                      {r.vendor_no === "UNASSIGNED" ? (
                        <Pill tone="red">no vendor</Pill>
                      ) : (
                        <>
                          {r.vendor_name || r.vendor_no}
                          {r.vendor_reliability !== null && r.vendor_reliability < 60 && (
                            <span style={{ marginLeft: 4, color: "var(--warn-dark)", fontWeight: 700, fontSize: 10 }} title={`${r.vendor_reliability}% on-time`}>⚠ {r.vendor_reliability}%</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="pu-right">
                      <input type="number" min={0} className="pu-cell-input" aria-label={`Quantity for ${r.item_no}`} value={r.qty} onChange={(e) => edit(r.item_no, { qty: Number(e.target.value) })} />
                    </td>
                    <td className="pu-right">
                      <input type="number" min={0} step={0.01} className="pu-cell-input pu-cell-input--wide" aria-label={`Unit price for ${r.item_no}`} value={r.price} onChange={(e) => edit(r.item_no, { price: Number(e.target.value) })} />
                    </td>
                    <td>
                      <input type="date" className="input" aria-label={`Delivery date for ${r.item_no}`} value={r.dlv} onChange={(e) => edit(r.item_no, { dlv: e.target.value })} />
                    </td>
                    <td className="pu-right" style={{ fontWeight: 700 }}>{formatMoney(r.qty * r.price)}</td>
                    <td>
                      <button className="pu-ai-pill" title={`${r.suggested.notes.join(" · ")}\n\n${r.rationale}`} onClick={() => restore(r.item_no)}>
                        {r.edited ? "Restore AI" : `${formatUnits(r.suggested.qty)} @ ${r.suggested.price}`}
                      </button>
                    </td>
                    <td>
                      <div className="pu-bar" style={{ gap: 4 }}>
                        {r.suggested.expedite && <Pill tone="red">Expedite</Pill>}
                        {!r.suggested.expedite && r.engine_qty <= 0 && r.open_pos.length > 0 && (
                          <Pill tone="yellow" title={`No new order needed; chase the vendor on: ${r.open_pos.map((p) => p.po_number).join(", ")}`}>Expedite open PO</Pill>
                        )}
                        {!r.suggested.expedite && r.engine_qty <= 0 && r.open_pos.length === 0 && (
                          <Pill tone="gray" title="The buy engine sees no shortfall and there is no open PO to expedite. Expand the row and review before acting.">No buy — review</Pill>
                        )}
                        {!r.suggested.expedite && r.engine_qty > 0 && r.suggested.flag_soon && <Pill tone="yellow">Soon</Pill>}
                        {r.edited && <Pill tone="blue">edited</Pill>}
                      </div>
                    </td>
                  </tr>
                  {open === r.item_no && (
                    <tr>
                      <td colSpan={11} style={{ padding: 0 }}>
                        <Detail line={r} proj={proj[r.item_no]} onPopup={(kind) => setPopup({ kind, line: r })} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="muted" style={{ padding: 32, textAlign: "center" }}>No red or yellow components right now — supply is covered.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="pu-footer">
        <div data-testid="pu-selection">
          <b>{selected.length}</b> line(s) selected across <b>{vendorCount}</b> vendor(s) · total <b>{formatMoney(total)}</b>
        </div>
        <button className="btn btn--primary" disabled={selected.length === 0 || posting} onClick={post}>
          {posting ? "Posting…" : `Post ${selected.length > 0 ? `${vendorCount} PO(s)` : "POs"} (simulated)`}
        </button>
      </div>
      {popup && <Popups popup={popup} today={todayIso(rt)} onClose={() => setPopup(null)} />}
    </div>
  );
}

function PersonaCard({ persona, onSaved, onError }: { persona: Persona; onSaved: (p: Persona) => void; onError: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(persona);
  useEffect(() => setDraft(persona), [persona]);
  const save = async () => {
    try {
      onSaved(await putPersona(draft));
      setOpen(false);
    } catch (e) {
      onError(errText(e));
    }
  };
  return (
    <Card title="Buyer persona">
      <div className="pu-persona">
        <div>
          <div className="pu-persona__title">{persona.name} — AI purchasing persona (rule-based)</div>
          <div className="pu-persona__sub">
            {persona.risk_posture} quantities · arrive {persona.delivery_padding_days}d early · horizon {persona.horizon} · {persona.respect_moq ? "MOQ-rounded" : "exact quantities"} ·{" "}
            <span className="muted">adjusts qty, dates &amp; flags only — never price or vendor · nothing pre-selected</span>
          </div>
        </div>
        <button className="btn" onClick={() => setOpen(!open)}>{open ? "Close" : "Persona Settings"}</button>
      </div>
      {open && (
        <div className="pu-persona__grid">
          <label>
            Buying horizon
            <select className="select" value={draft.horizon} onChange={(e) => setDraft({ ...draft, horizon: e.target.value as Persona["horizon"] })}>
              {HORIZON_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>
            Quantity posture
            <select className="select" value={draft.risk_posture} onChange={(e) => setDraft({ ...draft, risk_posture: e.target.value as Persona["risk_posture"] })}>
              {POSTURE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>
            Arrive early (days)
            <input type="number" min={0} max={30} className="input" value={draft.delivery_padding_days} onChange={(e) => setDraft({ ...draft, delivery_padding_days: Number(e.target.value) })} />
          </label>
          <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={draft.respect_moq} onChange={(e) => setDraft({ ...draft, respect_moq: e.target.checked })} />
            Round up to vendor MOQ / order multiples
          </label>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button className="btn btn--primary" onClick={save}>Save &amp; re-suggest</button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Kv({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="pu-kv">
      <span>{k}</span>
      <span className="mono" style={{ textAlign: "right" }}>{v}</span>
    </div>
  );
}

function Detail({ line: e, proj, onPopup }: { line: Row; proj: Projection | null | undefined; onPopup: (k: "so" | "po") => void }) {
  const soCount = sum(e.demand_detail.map((d) => d.sales_orders.length));
  const poQty = sum(e.open_pos.map((p) => p.qty));
  return (
    <div className="pu-expand">
      <div>
        <div className="muted" style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", marginBottom: 6 }}>{e.item_no} — supply picture</div>
        <Kv k="Required (order book)" v={<button className="pu-linkbtn" onClick={() => onPopup("so")}>{formatUnits(e.total_required)} — {soCount} SO(s) ▸</button>} />
        <Kv k="On open POs (total)" v={<button className="pu-linkbtn" onClick={() => onPopup("po")}>{formatUnits(poQty)} — {new Set(e.open_pos.map((p) => p.po_number)).size} PO(s), {e.open_pos.length} line(s) ▸</button>} />
        <Kv k="On hand" v={formatUnits(e.on_hand)} />
        <Kv k="Reserved" v={formatUnits(e.reserved)} />
        <Kv k="Net shortfall (window)" v={<b style={{ color: e.net_shortfall > 0 ? "var(--bad)" : "var(--ok)" }}>{formatUnits(e.net_shortfall)}</b>} />
        <Kv k="Suggested delivery" v={formatShortDate(e.delivery_date)} />
        <Kv k="Order by" v={formatShortDate(e.order_by)} />
        <Kv k="Lead time (effective)" v={`${e.lead_time_days} d`} />
        <Kv k="Reorder qty / MOQ / multiple" v={`${e.reorder_quantity > 0 ? formatUnits(e.reorder_quantity) : "—"} / ${formatUnits(e.moq)} / ${formatUnits(e.order_multiple)}`} />
        <Kv k="Last purchase price" v={fmtPrice(e.last_direct_cost)} />
        <Kv k="Unit cost (card)" v={fmtPrice(e.unit_cost)} />
        <Kv k="Monthly usage" v={formatUnits(e.monthly_usage)} />
        <Kv k="Vendor on-time" v={e.vendor_reliability !== null ? `${e.vendor_reliability}%` : "no history"} />
        <p className="muted" style={{ marginTop: 8, fontSize: 11, maxWidth: 330 }}>{e.rationale}</p>
      </div>
      <div>
        <div className="muted" style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", marginBottom: 6 }}>Projected balance (same chart as Supply Explorer)</div>
        {proj === undefined && <div className="muted" style={{ padding: "32px 0" }}>Loading projection…</div>}
        {proj === null && <div className="muted" style={{ padding: "32px 0" }}>No projection available for this item.</div>}
        {proj && <ProjectionChart proj={proj} granularity="week" width={640} height={190} />}
      </div>
    </div>
  );
}

function Popups({ popup, today, onClose }: { popup: NonNullable<Popup>; today: string; onClose: () => void }) {
  const { kind, line: l } = popup;
  const close = <button className="btn" onClick={onClose}>Close</button>;
  if (kind === "usedin") {
    return (
      <Modal title={`${l.item_no} — used in ${l.demand_detail.length} finished good(s)`} onClose={onClose} footer={close}>
        <table className="pu-sub">
          <thead>
            <tr><th>Finished Good</th><th>Description</th><th>Series</th><th className="pu-right">Qty of this part needed</th><th className="pu-right">Open SOs</th></tr>
          </thead>
          <tbody>
            {l.demand_detail.map((d) => (
              <tr key={d.fg_item_no}>
                <td className="mono">{d.fg_item_no}</td><td>{d.fg_description}</td><td>{d.series || "Other"}</td>
                <td className="pu-right mono">{formatUnits(d.required)}</td><td className="pu-right">{d.sales_orders.length}</td>
              </tr>
            ))}
            {l.demand_detail.length === 0 && <tr><td colSpan={5} className="muted">No finished good on the current order book uses this item.</td></tr>}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 11, marginTop: 10 }}>Cross-reference is based on the exploded BOMs of finished goods with open sales orders.</p>
      </Modal>
    );
  }
  if (kind === "so") {
    return (
      <Modal title={`Demand behind ${l.item_no} — ${formatUnits(l.total_required)} required`} onClose={onClose} footer={close}>
        {l.demand_detail.map((d) => (
          <div key={d.fg_item_no} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
              <span className="mono">{d.fg_item_no}</span> — {d.fg_description} <span className="muted" style={{ fontWeight: 400 }}>needs {formatUnits(d.required)} of this part</span>
            </div>
            <table className="pu-sub">
              <thead><tr><th>Sales Order</th><th>Customer</th><th className="pu-right">FG Qty</th><th>Delivery</th></tr></thead>
              <tbody>
                {d.sales_orders.map((o) => (
                  <tr key={`${d.fg_item_no}-${o.so_number}`}>
                    <td>{o.is_planned ? <Pill tone="blue">S&amp;OP plan</Pill> : <span className="mono">{o.so_number}</span>}</td>
                    <td>{o.customer_name ?? "—"}</td><td className="pu-right mono">{formatUnits(o.quantity)}</td><td>{formatShortDate(o.delivery_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        {l.demand_detail.length === 0 && <p className="muted">No order-book demand detail for this item.</p>}
      </Modal>
    );
  }
  return (
    <Modal title={`Open purchase orders covering ${l.item_no}`} onClose={onClose} footer={close}>
      <table className="pu-sub">
        <thead><tr><th>PO #</th><th>Vendor</th><th className="pu-right">Qty</th><th>Expected (ETA)</th><th /></tr></thead>
        <tbody>
          {l.open_pos.map((p) => {
            const late = p.eta !== null && p.eta < today;
            return (
              <tr key={p.po_number + (p.eta ?? "")}>
                <td className="mono">{p.po_number}</td><td>{l.vendor_name || p.vendor_no}</td><td className="pu-right mono">{formatUnits(p.qty)}</td>
                <td style={late ? { color: "var(--bad)", fontWeight: 700 } : undefined}>{formatShortDate(p.eta)}</td>
                <td>{late && <Pill tone="red">overdue — chase vendor</Pill>}</td>
              </tr>
            );
          })}
          {l.open_pos.length === 0 && <tr><td colSpan={5} className="muted">No open purchase orders for this item.</td></tr>}
          {l.open_pos.length > 0 && (
            <tr style={{ fontWeight: 700 }}>
              <td colSpan={2}>Total open — {new Set(l.open_pos.map((p) => p.po_number)).size} PO(s), {l.open_pos.length} line(s)</td>
              <td className="pu-right mono">{formatUnits(sum(l.open_pos.map((p) => p.qty)))}</td><td colSpan={2} />
            </tr>
          )}
        </tbody>
      </table>
    </Modal>
  );
}
