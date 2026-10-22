"use client";

import { ChevronDown, ChevronRight, Download } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { formatShortDate, formatUnits } from "@/domain/format";
import { whApi, type CompletedPo, type OrderLine } from "./api";
import { csvCell, downloadCsv, errText, Loading, StockModal, Th, useSortFilter } from "./shared";

export function Completed() {
  const [pos, setPos] = useState<CompletedPo[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, OrderLine[]>>({});
  const [stock, setStock] = useState<{ item: string; bin: string } | null>(null);

  useEffect(() => {
    whApi.completedPos().then(setPos).catch((e) => {
      setError(errText(e));
      setPos([]);
    });
  }, []);

  const sf = useSortFilter(pos ?? [], {
    po: { get: (r) => r.po_number },
    vendor: { get: (r) => `${r.vendor_name} ${r.vendor_no}` },
    last: { get: (r) => r.last_receipt_date },
    via: { get: (r) => (r.received_via_app ? "OCC" : "Other") },
  });
  if (!pos) return <Loading label="Loading completed purchase orders…" />;

  const toggle = (po: CompletedPo) => {
    const next = open === po.po_id ? null : po.po_id;
    setOpen(next);
    if (next && !lines[po.po_id]) {
      whApi.poReceivedLines(po.po_id).then((l) => setLines((x) => ({ ...x, [po.po_id]: l }))).catch(() => setLines((x) => ({ ...x, [po.po_id]: [] })));
    }
  };

  return (
    <Card
      title="Completed purchase orders"
      bodyClassName="wh-nopad"
      actions={
        <button
          className="btn"
          onClick={() =>
            downloadCsv("completed-pos.csv", [
              "PO,Vendor,Vendor No,Last Receipt,Via",
              ...sf.view.map((r) => [r.po_number, r.vendor_name, r.vendor_no, r.last_receipt_date, r.received_via_app ? "OCC app" : "Other"].map(csvCell).join(",")),
            ])
          }
        >
          <Download size={13} /> Export CSV
        </button>
      }
    >
      <p className="wh-help" style={{ padding: "0 12px" }}>
        Fully received orders, newest receipt first. Expand for lines; bins open the stock by bin.
      </p>
      {error && <p className="notice notice--bad">{error}</p>}
      <div className="table-scroll">
        <table className="dt">
          <thead>
            <tr>
              <Th sf={sf} id="po" label="PO" />
              <Th sf={sf} id="vendor" label="Vendor" />
              <Th sf={sf} id="last" label="Last Receipt" />
              <Th sf={sf} id="via" label="Received Via" />
              <th />
            </tr>
          </thead>
          <tbody>
            {sf.view.map((p) => (
              <Fragment key={p.po_id}>
                <tr style={{ cursor: "pointer" }} onClick={() => toggle(p)} aria-label={`PO ${p.po_number}`}>
                  <td>
                    {open === p.po_id ? <ChevronDown size={13} /> : <ChevronRight size={13} />} <b className="mono">{p.po_number}</b>
                  </td>
                  <td>
                    {p.vendor_name} <span className="wh-help">({p.vendor_no})</span>
                  </td>
                  <td className="mono">{formatShortDate(p.last_receipt_date)}</td>
                  <td>
                    <span className={`pill pill--${p.received_via_app ? "green" : "gray"}`}>{p.received_via_app ? "OCC app" : "Other"}</span>
                  </td>
                  <td className="num wh-help">{p.received_lines.length > 0 ? `${p.received_lines.length} receipt line(s)` : ""}</td>
                </tr>
                {open === p.po_id && (
                  <tr>
                    <td colSpan={5} style={{ background: "var(--surface2)" }}>
                      <div className="grid-2">
                        <div>
                          <b className="wh-help">Order lines</b>
                          <table className="wh-nowrap">
                            <tbody>
                              {(lines[p.po_id] ?? []).map((l, i) => (
                                <tr key={i}>
                                  <td className="mono">{l.item_no}</td>
                                  <td>{l.description}</td>
                                  <td className="mono">
                                    {formatUnits(l.received)} / {formatUnits(l.ordered)}
                                  </td>
                                </tr>
                              ))}
                              {!lines[p.po_id] && (
                                <tr>
                                  <td>Reading…</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                        <div>
                          <b className="wh-help">Receipts through this app (bin · lot)</b>
                          <table className="wh-nowrap">
                            <tbody>
                              {p.received_lines.map((r, i) => (
                                <tr key={i}>
                                  <td>{formatShortDate(r.receipt_date)}</td>
                                  <td className="mono">{r.item_no}</td>
                                  <td className="mono">{formatUnits(r.qty)}</td>
                                  <td className="mono">{r.lot_no || "—"}</td>
                                  <td>
                                    {r.bin_code ? (
                                      <button
                                        className="wh-link"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setStock({ item: r.item_no, bin: r.bin_code });
                                        }}
                                      >
                                        {r.bin_code}
                                      </button>
                                    ) : (
                                      "—"
                                    )}
                                  </td>
                                </tr>
                              ))}
                              {p.received_lines.length === 0 && (
                                <tr>
                                  <td>received outside the app — no bin/lot journal here</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {sf.view.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No completed purchase orders yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {stock && <StockModal item={stock.item} bin={stock.bin} onClose={() => setStock(null)} />}
    </Card>
  );
}
