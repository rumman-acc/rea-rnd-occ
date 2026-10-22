"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { formatMoney, formatShortDate, formatUnits, todayIso } from "@/domain/format";
import { csvCell, download, errText, Notice, Pill, Th, useTable } from "@/features/pricing/ui";
import { useRuntime } from "@/runtime/runtime";
import { getOpenPos } from "./api";
import type { OpenPo } from "./types";

/** Tab 2: open purchase orders (seeded POs are "Released", POs created here are "Open"). */
export function OpenPos() {
  const rt = useRuntime();
  const [rows, setRows] = useState<OpenPo[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    getOpenPos().then(setRows).catch((e) => { setError(errText(e)); setRows([]); });
  }, []);
  const t = useTable(rows ?? [], {
    po: { get: (r) => r.po_number },
    vendor: { get: (r) => r.vendor_name },
    date: { get: (r) => r.order_date },
    status: { get: (r) => r.status },
    amount: { get: (r) => r.amount, numeric: true, nofilter: true },
    received: { get: (r) => r.qty_received, numeric: true, nofilter: true },
    items: { get: (r) => r.items },
  });
  if (!rows) return <div className="muted" style={{ padding: "64px 0", textAlign: "center" }}>Loading purchase orders…</div>;

  const exportCsv = () => {
    const out = ["PO#,Vendor,OrderDate,Status,Amount,QtyOrdered,QtyReceived,Lines,Items"];
    for (const r of t.view) out.push([r.po_number, csvCell(r.vendor_name), r.order_date, r.status, r.amount, r.qty_ordered, r.qty_received, r.lines, csvCell(r.items)].join(","));
    download(`open-pos-${todayIso(rt)}.csv`, out);
  };

  return (
    <div className="stack">
      {error && <Notice tone="bad">{error}</Notice>}
      <Card
        title={`Purchase Orders — ${t.view.length} of ${rows.length} open & released documents`}
        bodyClassName="card__body--table"
        actions={<button className="btn btn--small" onClick={exportCsv}>Export CSV</button>}
      >
        <div className="table-scroll">
          <table className="dt">
            <thead>
              <tr>
                <Th t={t} id="po" label="PO #" />
                <Th t={t} id="vendor" label="Vendor" />
                <Th t={t} id="date" label="Order Date" />
                <Th t={t} id="status" label="Status" />
                <Th t={t} id="amount" label="Amount" right />
                <Th t={t} id="received" label="Received" right />
                <Th t={t} id="items" label="Items" />
              </tr>
            </thead>
            <tbody>
              {t.view.map((r) => (
                <tr key={r.po_number} style={{ whiteSpace: "nowrap" }}>
                  <td className="mono" style={{ fontWeight: 700 }}>{r.po_number}</td>
                  <td title={r.vendor_name}>{r.vendor_name}</td>
                  <td>{formatShortDate(r.order_date)}</td>
                  <td><Pill tone={r.status === "Released" ? "green" : "yellow"}>{r.status}</Pill></td>
                  <td className="pu-right mono">{formatMoney(r.amount)}</td>
                  <td className="pu-right mono">
                    <span style={{ color: r.qty_received > 0 ? "var(--ok)" : "var(--ink3)" }}>{formatUnits(r.qty_received)}</span>
                    <span className="muted"> / {formatUnits(r.qty_ordered)}</span>
                  </td>
                  <td className="mono" title={r.items} style={{ fontSize: 11 }}>{r.items}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="muted" style={{ padding: 32, textAlign: "center" }}>No open purchase orders.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
