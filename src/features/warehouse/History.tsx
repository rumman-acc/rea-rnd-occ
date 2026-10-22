"use client";

import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { formatUnits, todayIso } from "@/domain/format";
import { useRuntime } from "@/runtime/runtime";
import { whApi, type HistoryEntry } from "./api";
import { csvCell, downloadCsv, errText, Loading, Th, useSortFilter } from "./shared";

const KINDS: [HistoryEntry["type"], string][] = [
  ["receipt", "Receipts"],
  ["move", "Movements"],
  ["adjust", "Adjustments"],
];

const tone = (s: string) => (s === "posted" ? "green" : s === "staged" ? "yellow" : "red");

function detail(e: HistoryEntry): string {
  if (e.type === "receipt") return (e.lines ?? []).map((l) => `${l.item_no} × ${l.qty}${l.lot_no ? ` lot ${l.lot_no}` : ""}${l.bin_code ? ` → ${l.bin_code}` : ""}`).join("; ");
  if (e.type === "move") return `${e.item_no} × ${formatUnits(e.qty ?? 0)}: ${e.from_bin} → ${e.to_bin}${e.lot_no ? ` (lot ${e.lot_no})` : ""}`;
  return `${e.item_no} ${(e.qty ?? 0) >= 0 ? "+" : ""}${formatUnits(e.qty ?? 0)}${e.bin_code ? ` @ ${e.bin_code}` : ""} ${e.reason ?? ""}`.trim();
}

export function History() {
  const rt = useRuntime();
  const [kind, setKind] = useState<HistoryEntry["type"]>("receipt");
  const [all, setAll] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    whApi.history().then(setAll).catch((e) => {
      setError(errText(e));
      setAll([]);
    });
  }, []);
  const rows = useMemo(() => (all ?? []).filter((h) => h.type === kind), [all, kind]);
  const sf = useSortFilter(rows, {
    ts: { get: (e) => e.ts },
    operator: { get: (e) => e.operator },
    ref: { get: (e) => e.po_number ?? e.item_no ?? "" },
    detail: { get: detail, sort: false },
    status: { get: (e) => e.status },
  });
  if (!all) return <Loading label="Loading history…" />;

  return (
    <Card
      title="Warehouse History — receipts, movements and adjustments made from the app, journaled with operator"
      bodyClassName="wh-nopad"
      actions={
        <>
          <div className="tabs" role="tablist" aria-label="History kind" style={{ margin: 0, border: 0 }}>
            {KINDS.map(([k, label]) => (
              <button key={k} role="tab" aria-selected={kind === k} className={`tab ${kind === k ? "tab--active" : ""}`} onClick={() => setKind(k)}>
                {label}
              </button>
            ))}
          </div>
          <button
            className="btn"
            onClick={() =>
              downloadCsv(`warehouse-history-${todayIso(rt)}.csv`, [
                "Timestamp,Type,Operator,Status,PO#,Item,Qty,Lot,FromBin,ToBin,Bin,Error",
                ...sf.view.map((e) => [e.ts, e.type, e.operator, e.status, e.po_number, e.item_no, e.qty, e.lot_no, e.from_bin, e.to_bin, e.bin_code, e.error].map(csvCell).join(",")),
              ])
            }
          >
            <Download size={13} /> Export CSV
          </button>
        </>
      }
    >
      {error && <p className="notice notice--bad">{error}</p>}
      <div className="table-scroll">
        <table className="dt wh-nowrap">
          <thead>
            <tr>
              <Th sf={sf} id="ts" label="When" />
              <Th sf={sf} id="operator" label="Operator" />
              <Th sf={sf} id="ref" label="Reference" />
              <Th sf={sf} id="detail" label="Detail" />
              <Th sf={sf} id="status" label="Status" />
            </tr>
          </thead>
          <tbody>
            {sf.view.map((e) => (
              <tr key={e.id}>
                <td className="mono">{e.ts.replace("T", " ").slice(0, 16)}</td>
                <td>{e.operator}</td>
                <td className="mono">{e.po_number ?? e.item_no ?? "—"}</td>
                <td title={JSON.stringify(e)} style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {detail(e)}
                </td>
                <td>
                  <span className={`pill pill--${tone(e.status)}`}>{e.status}</span>
                </td>
              </tr>
            ))}
            {sf.view.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  Nothing here yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
