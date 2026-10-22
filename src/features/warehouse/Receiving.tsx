"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatShortDate, formatUnits, todayIso } from "@/domain/format";
import { useRuntime } from "@/runtime/runtime";
import { whApi, type Bin, type ReceiptResult, type ReceivingPo, type ReceivingTodo } from "./api";
import { errText, Loading, StockModal } from "./shared";

interface LineEdit {
  qty: number;
  lot: string;
  bin: string;
  zone?: string;
  include: boolean;
  close: boolean;
}

export function Receiving() {
  const [todo, setTodo] = useState<ReceivingTodo | null>(null);
  const [bins, setBins] = useState<Bin[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ReceiptResult>>({});

  const load = useCallback(() => {
    whApi.receiving().then(setTodo).catch((e) => setError(errText(e)));
    whApi.bins().then(setBins).catch(() => {});
  }, []);
  useEffect(load, [load]);

  if (!todo) return error ? <p className="notice notice--bad">{error}</p> : <Loading label="Loading the receiving list…" />;
  const listed = new Set(todo.pos.map((p) => p.po_id));
  const gone = Object.entries(results).filter(([id]) => !listed.has(id));
  return (
    <div className="stack">
      <div className="notice" role="note">
        <b>{todo.al_mode ? "Automated posting (simulated)" : "Staged mode"}</b>
        {" — "}
        {todo.al_mode
          ? "receipts post straight into this app's demo master data (stock, purchase order lines). There is no Business Central connection."
          : "receipts are staged and journaled here for a later manual posting step."}
      </div>
      {error && <p className="notice notice--bad">{error}</p>}
      {gone.map(([id, r]) => (
        <div key={id} className="wh-box" role="status">
          {id}: receipt {r.status} · {(r.lines ?? []).filter((l) => l.result === "ok").length}/{r.lines?.length ?? 0} lines OK — fully received, removed from the list.
        </div>
      ))}
      {todo.pos.map((po) => (
        <PoCard
          key={po.po_id}
          po={po}
          bins={bins}
          location={todo.location}
          tolerancePct={todo.settings?.over_delivery_tolerance_pct ?? 0}
          expanded={open === po.po_id}
          result={results[po.po_id] ?? null}
          onResult={(r) => setResults((x) => ({ ...x, [po.po_id]: r }))}
          onToggle={() => setOpen(open === po.po_id ? null : po.po_id)}
          onPosted={load}
        />
      ))}
      {todo.pos.length === 0 && (
        <section className="card">
          <div className="card__body empty">Nothing to receive — no outstanding purchase order lines.</div>
        </section>
      )}
    </div>
  );
}

function PoCard(props: {
  po: ReceivingPo;
  bins: Bin[];
  location: string;
  tolerancePct: number;
  expanded: boolean;
  result: ReceiptResult | null;
  onResult: (r: ReceiptResult) => void;
  onToggle: () => void;
  onPosted: () => void;
}) {
  const { po, bins, location, tolerancePct, expanded, result, onResult, onToggle, onPosted } = props;
  const rt = useRuntime();
  const [edits, setEdits] = useState<Record<string, LineEdit>>({});
  const [posting, setPosting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [stock, setStock] = useState<{ item: string; bin: string } | null>(null);
  const [date, setDate] = useState(() => todayIso(rt));
  const selectAll = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEdits(Object.fromEntries(po.lines.map((l) => [l.line_id, { qty: l.outstanding, lot: "", bin: l.suggested_bin, include: true, close: false }])));
    setConfirming(false);
  }, [po]);

  const zones = Array.from(new Set(bins.map((b) => b.zone).filter(Boolean))).sort();
  const zoneOf = (code: string) => bins.find((b) => b.code === code)?.zone ?? "";
  const overdue = po.lines.filter((l) => l.overdue).length;
  const included = po.lines.filter((l) => edits[l.line_id]?.include);

  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = included.length > 0 && included.length < po.lines.length;
  });

  const requestPost = () => {
    setMessage("");
    const missing = included.filter((l) => l.lot_required && !(edits[l.line_id]?.lot ?? "").trim());
    if (missing.length) return setMessage(`Lot number required for: ${missing.map((l) => l.item_no).join(", ")}`);
    setConfirming(true);
  };

  const post = async () => {
    setConfirming(false);
    setPosting(true);
    setMessage("");
    try {
      const r = await whApi.postReceipt({
        po_id: po.po_id,
        po_number: po.po_number,
        receipt_date: date,
        lines: included.map((l) => {
          const e = edits[l.line_id];
          return { line_id: l.line_id, sequence: l.sequence, item_no: l.item_no, qty: e.qty, lot_no: e.lot, bin_code: e.bin, close_line: e.close };
        }),
      });
      onResult(r);
      if (r.status !== "rejected") onPosted();
    } catch (e) {
      setMessage(errText(e));
    } finally {
      setPosting(false);
    }
  };

  const okCount = (result?.lines ?? []).filter((l) => l.result === "ok").length;
  const pillTone = (s: string) => (s === "posted" ? "green" : s === "staged" ? "yellow" : "red");

  return (
    <section className="card wh-po">
      <button className="wh-po__head" onClick={onToggle} aria-expanded={expanded} aria-label={`PO ${po.po_number}`}>
        <span className="wh-po__left">
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <b className="mono">{po.po_number}</b>
          <span>{po.vendor_name}</span>
          <span className={`pill pill--${po.releasable ? "green" : "yellow"}`}>{po.releasable ? po.status : `${po.status} — release first`}</span>
          {result && (
            <span className={`pill pill--${pillTone(result.status)}`}>
              receipt {result.status} · {okCount}/{result.lines?.length ?? 0} OK
            </span>
          )}
          {po.received_lines.length > 0 && !result && <span className="pill pill--blue">{po.received_lines.length} prior receipt(s)</span>}
        </span>
        <span className="wh-po__right">
          expected {formatShortDate(po.expected_date)} · {po.lines.length} line(s)
          {overdue > 0 && <span className="pill pill--red">{overdue} overdue</span>}
        </span>
      </button>
      {expanded && (
        <div className="wh-po__body">
          {result && (
            <div className={`wh-box ${result.status === "rejected" || result.status === "failed" ? "wh-box--bad" : ""}`} role="status">
              {result.status === "rejected" ? (
                <>Rejected: {result.errors?.join("; ")}</>
              ) : (
                <>
                  Receipt {result.status} for {po.po_number} — {okCount}/{result.lines?.length ?? 0} line(s) OK.
                  {result.status === "staged" && " Posting is still to be completed."}
                  {result.posting_date_change?.changed && (
                    <span className="wh-note">
                      PO posting date moved {result.posting_date_change.before} → {result.posting_date_change.after} so the receipt lands on the day the goods arrived.
                    </span>
                  )}
                  {result.posting_date_change?.error && <span className="wh-note wh-note--warn">{result.posting_date_change.error}</span>}
                  {(result.lines ?? []).filter((l) => l.result === "failed").map((l, i) => (
                    <span key={i} className="wh-note wh-note--warn">
                      {l.item_no}: {String(l.error ?? "").slice(0, 300)}
                    </span>
                  ))}
                </>
              )}
            </div>
          )}
          <div className="table-scroll wh-lines">
            <table className="dt">
              <thead>
                <tr>
                  <th>
                    <input
                      ref={selectAll}
                      type="checkbox"
                      title="Select / deselect all lines"
                      aria-label="Select / deselect all lines"
                      checked={po.lines.length > 0 && included.length === po.lines.length}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setEdits((cur) => Object.fromEntries(po.lines.map((l) => [l.line_id, { ...(cur[l.line_id] ?? { qty: l.outstanding, lot: "", bin: l.suggested_bin, close: false }), include: v }])));
                      }}
                    />
                  </th>
                  <th>Item</th>
                  <th>Outstanding</th>
                  <th>Receive Qty</th>
                  <th>Fully received</th>
                  <th>Lot No.</th>
                  <th>Zone / Bin ({location})</th>
                  <th>Expected</th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map((l) => {
                  const e = edits[l.line_id] ?? { qty: 0, lot: "", bin: "", include: false, close: false };
                  const set = (p: Partial<LineEdit>) => setEdits((cur) => ({ ...cur, [l.line_id]: { ...e, ...p } }));
                  const over = e.qty > l.outstanding + 1e-9;
                  const under = e.qty < l.outstanding - 1e-9;
                  const zone = e.zone !== undefined ? e.zone : zoneOf(e.bin);
                  return (
                    <tr key={l.line_id}>
                      <td>
                        <input type="checkbox" aria-label={`Include ${l.item_no}`} checked={e.include} onChange={(ev) => set({ include: ev.target.checked })} />
                      </td>
                      <td>
                        <b className="mono">{l.item_no}</b> <span className="wh-help">{l.description}</span>
                      </td>
                      <td className="mono">
                        {formatUnits(l.outstanding)}
                        {l.received > 0 && (
                          <span className="wh-note">
                            {formatUnits(l.received)} of {formatUnits(l.ordered)} received
                          </span>
                        )}
                      </td>
                      <td>
                        <input
                          type="number"
                          className={`input mono ${over ? "wh-over" : ""}`}
                          aria-label={`Receive qty ${l.item_no}`}
                          min={0}
                          max={Math.max(0, l.ordered * (1 + tolerancePct / 100) - l.received)}
                          value={e.qty}
                          onChange={(ev) => set({ qty: Number(ev.target.value) })}
                        />
                        {over && (
                          <span className="wh-note wh-note--warn">
                            over-delivery — PO line is raised to {formatUnits(l.received + e.qty)} (tolerance {tolerancePct}%)
                          </span>
                        )}
                      </td>
                      <td>
                        {under && e.include ? (
                          <label className="wh-help" title="After receiving, the ordered quantity is cut to what arrived, so no open remainder stays.">
                            <input type="checkbox" checked={e.close} onChange={(ev) => set({ close: ev.target.checked })} /> close short
                          </label>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {l.lot_required ? (
                          <input className="input mono" aria-label={`Lot ${l.item_no}`} placeholder="required" value={e.lot} onChange={(ev) => set({ lot: ev.target.value })} />
                        ) : (
                          <span className="wh-help">not tracked</span>
                        )}
                      </td>
                      <td>
                        <div className="wh-pair">
                          <select
                            className="select"
                            title="Zone"
                            aria-label={`Zone ${l.item_no}`}
                            value={zone}
                            onChange={(ev) => {
                              const z = ev.target.value;
                              set({ zone: z, bin: zoneOf(l.suggested_bin) === z ? l.suggested_bin : "" });
                            }}
                          >
                            <option value="">— zone —</option>
                            {zones.map((z) => (
                              <option key={z} value={z}>
                                {z}
                              </option>
                            ))}
                          </select>
                          <select className="select" title="Bin" aria-label={`Bin ${l.item_no}`} disabled={!zone} value={e.bin} onChange={(ev) => set({ zone, bin: ev.target.value })}>
                            <option value="">{zone ? "— bin —" : "zone first"}</option>
                            {bins
                              .filter((b) => b.zone === zone)
                              .map((b) => (
                                <option key={b.code} value={b.code}>
                                  {b.code}
                                  {b.code === l.suggested_bin ? " (default)" : ""}
                                </option>
                              ))}
                          </select>
                        </div>
                      </td>
                      <td className={l.overdue ? "overdue" : ""}>{formatShortDate(l.expected_date)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {po.received_lines.length > 0 && (
            <div className="wh-prior">
              <b>Already received on this PO</b>
              <table className="wh-nowrap">
                <tbody>
                  {po.received_lines.map((r, i) => (
                    <tr key={i}>
                      <td>{formatShortDate(r.receipt_date)}</td>
                      <td className="mono">{r.item_no}</td>
                      <td className="mono">{formatUnits(r.qty)}</td>
                      <td className="mono">{r.lot_no || "—"}</td>
                      <td>{r.bin_code ? <button className="wh-link" onClick={() => setStock({ item: r.item_no, bin: r.bin_code })}>{r.bin_code}</button> : "—"}</td>
                      <td>{r.operator}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {stock && <StockModal item={stock.item} bin={stock.bin} onClose={() => setStock(null)} />}
          {message && (
            <p className="notice notice--bad" role="alert">
              {message}
            </p>
          )}
          <div className="wh-foot">
            <label className="wh-foot__date">
              <b>Receipt date</b>
              <input type="date" className="input mono" value={date} onChange={(e) => setDate(e.target.value)} />
              <span>posts on this date; the PO posting date is aligned to it</span>
            </label>
            {!po.releasable && <span className="wh-note wh-note--warn">Release this PO before receiving.</span>}
            {confirming ? (
              <span className="wh-foot" role="alert">
                <span>
                  Receive {included.length} line(s) on {po.po_number} at {location}, dated {date}?
                </span>
                <button className="btn btn--primary" onClick={post}>
                  Confirm receipt
                </button>
                <button className="btn" onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button className="btn btn--primary" onClick={requestPost} disabled={posting || included.length === 0 || !po.releasable}>
                Post Receipt ({included.length})
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
