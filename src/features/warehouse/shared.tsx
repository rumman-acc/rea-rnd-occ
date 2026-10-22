"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { whApi, type StockRow } from "./api";

export function Loading({ label }: { label: string }) {
  return (
    <div className="wh-loading" role="status">
      {label}
    </div>
  );
}

export function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const json = /\{.*\}/.exec(m);
  if (json) {
    try {
      const d = (JSON.parse(json[0]) as { detail?: string }).detail;
      if (d) return d;
    } catch {
      // fall through
    }
  }
  return m;
}

export function downloadCsv(name: string, rows: string[]) {
  const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="wh-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="wh-modal__box">
        <h3 className="wh-modal__title">{title}</h3>
        {children}
        <div className="wh-modal__foot">
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** Stock by bin for one item (REQ-WH-STK-001). */
export function StockModal({ item, bin, onClose }: { item: string; bin?: string; onClose: () => void }) {
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    whApi.itemStock(item).then(setRows).catch((e) => setError(errText(e)));
  }, [item]);
  return (
    <Modal title={`${item} — stock by bin`} onClose={onClose}>
      {error && <p className="wh-error">{error}</p>}
      {!rows && !error && <p>Reading stock…</p>}
      {rows && (
        <table className="dt">
          <thead>
            <tr>
              <th>Zone</th>
              <th>Bin</th>
              <th>Lot</th>
              <th className="num">Qty</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.bin === bin ? "wh-hl" : undefined}>
                <td>{r.zone}</td>
                <td className="mono">
                  {r.bin}
                  {r.bin === bin ? " ←" : ""}
                </td>
                <td className="mono">{r.lot || "—"}</td>
                <td className="num mono">{r.qty}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  No stock for this item at the moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

export interface ColDef<T> {
  get: (row: T) => string | number | null | undefined;
  numeric?: boolean;
  sort?: boolean;
  filter?: boolean;
}

/** Single-column sort (none → asc → desc → none) plus per-column substring filters. */
export function useSortFilter<T>(rows: T[], cols: Record<string, ColDef<T>>) {
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const view = useMemo(() => {
    let out = rows;
    for (const [id, col] of Object.entries(cols)) {
      const needle = (filters[id] ?? "").trim().toLowerCase();
      if (needle) out = out.filter((r) => String(col.get(r) ?? "").toLowerCase().includes(needle));
    }
    if (sort && cols[sort.id]) {
      const col = cols[sort.id];
      out = [...out].sort((a, b) =>
        col.numeric ? ((Number(col.get(a)) || 0) - (Number(col.get(b)) || 0)) * sort.dir : String(col.get(a) ?? "").localeCompare(String(col.get(b) ?? "")) * sort.dir,
      );
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, filters]);
  return {
    view,
    sort,
    filters,
    cols,
    toggle: (id: string) => setSort((s) => (s?.id === id ? (s.dir === 1 ? { id, dir: -1 } : null) : { id, dir: 1 })),
    setFilter: (id: string, v: string) => setFilters((f) => ({ ...f, [id]: v })),
  };
}

export type SF<T> = ReturnType<typeof useSortFilter<T>>;

export function Th<T>({ sf, id, label }: { sf: SF<T>; id: string; label: string }) {
  const col = sf.cols[id];
  const sortable = col?.sort !== false;
  const arrow = sf.sort?.id === id ? (sf.sort.dir === 1 ? " ▲" : " ▼") : "";
  return (
    <th>
      <button className="wh-th" onClick={sortable ? () => sf.toggle(id) : undefined} title={sortable ? "Click to sort" : undefined}>
        {label}
        {arrow}
      </button>
      {col?.filter !== false && (
        <input className="wh-filter" aria-label={`Filter ${label}`} placeholder="filter…" value={sf.filters[id] ?? ""} onChange={(e) => sf.setFilter(id, e.target.value)} />
      )}
    </th>
  );
}
