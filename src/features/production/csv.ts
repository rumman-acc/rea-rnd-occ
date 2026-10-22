import type { LinkageRow, OrderRow } from "./api";

const q = (s: string) => `"${s.replaceAll('"', '""')}"`;

export const ORDERS_CSV_HEADER = "PO#,Customer,Item,Series,Model,Start,End,Remaining,ProgressPct,Linked,SODue,Health";
export const LINKAGE_CSV_HEADER = "SO#,Customer,Series,Model,SODelivery,OpenQty,LinkedPO,POEnd,BufferDays,Status";

export type CoverageStatus = "no-po" | "late" | "tight" | "ok";

/** PRD-UI-013 */
export function coverageStatus(r: LinkageRow): CoverageStatus {
  if (!r.prod_order_no) return "no-po";
  if (r.buffer_days === null) return "ok";
  return r.buffer_days < 0 ? "late" : r.buffer_days < 7 ? "tight" : "ok";
}

export function ordersCsv(rows: OrderRow[]): string[] {
  return [
    ORDERS_CSV_HEADER,
    ...rows.map((r) =>
      [r.po_number, q(r.customer_name), r.item_no, r.series, q(r.model), r.start_date, r.end_date, r.quantity, r.pct_complete, r.linked ? "yes" : "no", r.delivery_date ?? "", r.health ?? ""].join(","),
    ),
  ];
}

export function linkageCsv(rows: LinkageRow[]): string[] {
  return [
    LINKAGE_CSV_HEADER,
    ...rows.map((r) =>
      [r.so_number, q(r.customer_name ?? ""), r.series ?? "", q(r.model), r.delivery_date ?? "", r.quantity, r.prod_order_no ?? "", r.prod_end ?? "", r.buffer_days ?? "", coverageStatus(r)].join(","),
    ),
  ];
}

/** Browser download of CSV lines (no-op where Blob URLs are unavailable). */
export function downloadCsv(name: string, lines: string[]): void {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return;
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
