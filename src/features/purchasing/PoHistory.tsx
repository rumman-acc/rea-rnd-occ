"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { formatMoney, formatShortDate, formatUnits, todayIso } from "@/domain/format";
import { csvCell, download, errText, Notice, Pill, Th, useTable } from "@/features/pricing/ui";
import { useRuntime } from "@/runtime/runtime";
import { getPoHistory, getPurchaseHistory } from "./api";
import type { PoHistoryRow, PurchaseEntry } from "./types";

interface Group {
  key: string;
  title: string;
  subtitle: string;
  orders: number;
  qo: number;
  qr: number;
  ao: number;
  ar: number;
  entries: PurchaseEntry[];
}

type By = "vendor" | "item";
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Tab 3: posted purchase invoices merged with the open PO book, plus POs created from the app. */
export function PoHistory() {
  const rt = useRuntime();
  const [entries, setEntries] = useState<PurchaseEntry[] | null>(null);
  const [error, setError] = useState("");
  const [by, setBy] = useState<By>("vendor");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    getPurchaseHistory().then((r) => setEntries(r.entries)).catch((e) => setError(errText(e)));
  }, []);

  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, Group>();
    for (const e of entries ?? []) {
      const key = by === "vendor" ? e.vendor_name || e.vendor_no || "Unknown vendor" : e.item_no;
      const g = m.get(key) ?? { key, title: key, subtitle: by === "vendor" ? e.vendor_no : `${e.description}${e.model ? ` · ${e.model}` : ""}`, orders: 0, qo: 0, qr: 0, ao: 0, ar: 0, entries: [] };
      g.qo += e.qty_ordered; g.qr += e.qty_received; g.ao += e.amount_ordered; g.ar += e.amount_received;
      g.entries.push(e);
      m.set(key, g);
    }
    const out = [...m.values()];
    out.forEach((g) => (g.orders = new Set(g.entries.map((e) => e.po_number)).size));
    return out.sort((a, b) => b.ar - a.ar || b.ao - a.ao || a.key.localeCompare(b.key));
  }, [entries, by]);

  const totals = useMemo(() => {
    const all = entries ?? [];
    return { orders: new Set(all.map((e) => e.po_number)).size, qo: sum(all.map((e) => e.qty_ordered)), qr: sum(all.map((e) => e.qty_received)), ao: sum(all.map((e) => e.amount_ordered)), ar: sum(all.map((e) => e.amount_received)) };
  }, [entries]);

  const t = useTable(groups, {
    who: { get: (g) => `${g.title} ${g.subtitle} ${g.entries.map((e) => e.po_number).join(" ")}` },
    orders: { get: (g) => g.orders, numeric: true },
    qo: { get: (g) => g.qo, numeric: true },
    qr: { get: (g) => g.qr, numeric: true },
    ao: { get: (g) => g.ao, numeric: true },
    ar: { get: (g) => g.ar, numeric: true },
    bal: { get: (g) => g.ao - g.ar, numeric: true },
  });

  function exportCsv() {
    if (!entries) return;
    const out = ["PO#,Vendor,Item,Description,Series,Model,ExpectedDate,FirstInvoice,LastInvoice,QtyOrdered,QtyReceived,AmtOrdered,AmtReceived,Status"];
    for (const e of entries) {
      out.push([e.po_number, csvCell(e.vendor_name), e.item_no, csvCell(e.description), e.series, csvCell(e.model), e.expected_date ?? "", e.first_invoice_date ?? "", e.last_invoice_date ?? "", e.qty_ordered, e.qty_received, e.amount_ordered, e.amount_received, e.status].join(","));
    }
    download(`po-history-${todayIso(rt)}.csv`, out);
  }

  return (
    <div className="stack">
      <Card title="Summary">
        <div className="pu-bar muted" style={{ fontSize: 12 }}>
          {entries ? (
            <span data-testid="pu-history-summary">
              <b style={{ color: "var(--ink)" }}>{totals.orders}</b> purchase orders · ordered{" "}
              <b style={{ color: "var(--ink)" }}>{formatUnits(totals.qo)}u / {formatMoney(totals.ao)}</b> · invoiced{" "}
              <b style={{ color: "var(--ink)" }}>{formatUnits(totals.qr)}u / {formatMoney(totals.ar)}</b>
            </span>
          ) : (
            <span>Posted purchase invoices merged with the open PO book</span>
          )}
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <span className="pw-tabs" role="group" aria-label="Group by">
              {(["vendor", "item"] as const).map((k) => (
                <button key={k} className={by === k ? "is-active" : ""} aria-pressed={by === k} onClick={() => { setBy(k); setExpanded(new Set()); }}>
                  {k === "vendor" ? "By Vendor" : "By Item"}
                </button>
              ))}
            </span>
            <button className="btn btn--small" disabled={!entries} onClick={exportCsv}>Export CSV</button>
          </span>
        </div>
      </Card>
      {error && <Notice tone="bad">{error}</Notice>}
      {!entries && !error && <div className="muted" style={{ padding: "64px 0", textAlign: "center" }}>Loading posted purchase invoices…</div>}
      {entries && (
        <div className="card table-scroll">
          <table className="dt pu-groups">
            <thead>
              <tr>
                <Th t={t} id="who" label={by === "vendor" ? "Vendor" : "Item"} />
                <Th t={t} id="orders" label="POs" right />
                <Th t={t} id="qo" label="Qty Ordered" right />
                <Th t={t} id="qr" label="Qty Invoiced" right />
                <Th t={t} id="ao" label="Amount Ordered" right />
                <Th t={t} id="ar" label="Amount Invoiced" right />
                <Th t={t} id="bal" label="Open Balance" right />
              </tr>
            </thead>
            <tbody>
              {t.view.map((g) => {
                const isOpen = expanded.has(g.key);
                const toggle = () => setExpanded((s) => { const n = new Set(s); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; });
                const bal = g.ao - g.ar;
                return (
                  <Fragment key={g.key}>
                    <tr onClick={toggle} style={{ cursor: "pointer" }} aria-expanded={isOpen}>
                      <td className="pu-group">
                        {isOpen ? "▾" : "▸"} {g.title} <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>{g.subtitle}</span>
                      </td>
                      <td className="pu-right mono">{g.orders}</td>
                      <td className="pu-right mono" style={{ fontWeight: 700 }}>{formatUnits(g.qo)}</td>
                      <td className="pu-right mono">{formatUnits(g.qr)}</td>
                      <td className="pu-right mono" style={{ fontWeight: 700 }}>{formatMoney(g.ao)}</td>
                      <td className="pu-right mono">{formatMoney(g.ar)}</td>
                      <td className="pu-right mono" style={bal > 0.005 ? { color: "var(--warn-dark)", fontWeight: 700 } : { color: "var(--ink3)" }}>{formatMoney(bal)}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={7} style={{ padding: 0 }}>
                          <table className="pu-sub">
                            <thead>
                              <tr>
                                <th>PO #</th><th>{by === "vendor" ? "Item" : "Vendor"}</th><th>Model</th><th>Expected</th><th>First Inv.</th><th>Last Inv.</th>
                                <th className="pu-right">Qty Ord.</th><th className="pu-right">Qty Invoiced</th><th className="pu-right">Amt Ordered</th><th className="pu-right">Amt Invoiced</th><th>Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...g.entries].sort((a, b) => ((b.last_invoice_date ?? b.expected_date ?? "") < (a.last_invoice_date ?? a.expected_date ?? "") ? -1 : 1)).map((e, i) => (
                                <tr key={`${e.po_number}-${e.item_no}-${i}`}>
                                  <td className="mono" style={{ fontWeight: 700 }}>{e.po_number}</td>
                                  <td>{by === "vendor" ? <><span className="mono">{e.item_no}</span> <span className="muted">{e.description}</span></> : e.vendor_name || e.vendor_no || "—"}</td>
                                  <td>{e.model || "—"}</td>
                                  <td>{formatShortDate(e.expected_date)}</td><td>{formatShortDate(e.first_invoice_date)}</td><td>{formatShortDate(e.last_invoice_date)}</td>
                                  <td className="pu-right mono">{formatUnits(e.qty_ordered)}</td><td className="pu-right mono">{formatUnits(e.qty_received)}</td>
                                  <td className="pu-right mono">{formatMoney(e.amount_ordered)}</td><td className="pu-right mono">{formatMoney(e.amount_received)}</td>
                                  <td><Pill tone={e.status === "open" ? "yellow" : "green"}>{e.status}</Pill></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              <tr className="pu-total">
                <td>TOTAL</td>
                <td className="pu-right mono">{totals.orders}</td>
                <td className="pu-right mono">{formatUnits(totals.qo)}</td>
                <td className="pu-right mono">{formatUnits(totals.qr)}</td>
                <td className="pu-right mono">{formatMoney(totals.ao)}</td>
                <td className="pu-right mono">{formatMoney(totals.ar)}</td>
                <td className="pu-right mono">{formatMoney(totals.ao - totals.ar)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <CreatedPos />
    </div>
  );
}

function CreatedPos() {
  const [rows, setRows] = useState<PoHistoryRow[] | null>(null);
  useEffect(() => {
    getPoHistory().then(setRows).catch(() => setRows([]));
  }, []);
  const t = useTable(rows ?? [], {
    ts: { get: (r) => r.ts },
    operator: { get: (r) => r.operator },
    po: { get: (r) => r.po_number ?? "" },
    vendor: { get: (r) => r.vendor_name || r.vendor_no },
    amount: { get: (r) => r.amount ?? 0, numeric: true, nofilter: true },
    items: { get: (r) => r.lines.map((l) => l.item_no).join(" ") },
    status: { get: (r) => r.status },
  });
  return (
    <Card title="POs created from the app — journaled with operator" bodyClassName="card__body--table">
      <div className="table-scroll">
        <table className="dt">
          <thead>
            <tr>
              <Th t={t} id="ts" label="Created" />
              <Th t={t} id="operator" label="Operator" />
              <Th t={t} id="po" label="PO #" />
              <Th t={t} id="vendor" label="Vendor" />
              <Th t={t} id="amount" label="Amount" right />
              <Th t={t} id="items" label="Items" />
              <Th t={t} id="status" label="Status" />
            </tr>
          </thead>
          <tbody>
            {t.view.map((r) => (
              <tr key={r.id} style={{ whiteSpace: "nowrap" }}>
                <td className="mono" style={{ fontSize: 11 }}>{r.ts.replace("T", " ").slice(0, 16)}</td>
                <td>{r.operator}</td>
                <td className="mono" style={{ fontWeight: 700 }}>{r.po_number ?? "—"}</td>
                <td>{r.vendor_name || r.vendor_no}</td>
                <td className="pu-right mono">{r.amount != null ? formatMoney(r.amount) : "—"}</td>
                <td className="mono" style={{ fontSize: 11 }} title={r.lines.map((l) => `${l.item_no} × ${l.qty}`).join(", ")}>{r.lines.map((l) => l.item_no).join(", ")}</td>
                <td><Pill tone={r.status === "created" ? "green" : "red"} title={r.error}>{r.status}</Pill></td>
              </tr>
            ))}
            {rows && t.view.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ padding: 32, textAlign: "center" }}>No POs created from the app yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
