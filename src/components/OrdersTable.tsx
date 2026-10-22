"use client";

import { useMemo, useState } from "react";
import { formatMoney, formatShortDate, formatUnits, todayIso } from "@/domain/format";
import { COLUMNS, nextSort, rowValue, statusLabel, viewRows, type ColumnId, type Filters, type SortState } from "@/domain/table";
import type { StatusRow } from "@/domain/types";
import { useRuntime } from "@/runtime/runtime";

/**
 * At-Risk Sales Orders table body (SPEC §2.7). `rows` are the non-green rows in
 * provider order. Sort/filter state is local and not persisted (TBL-025).
 */
export function OrdersTable({ rows }: { rows: readonly StatusRow[] }) {
  const rt = useRuntime();
  const [sort, setSort] = useState<SortState | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const view = useMemo(() => viewRows(rows, filters, sort), [rows, filters, sort]);
  const today = todayIso(rt);

  const arrow = (id: ColumnId) => (sort?.id === id ? (sort.dir === 1 ? " ▲" : " ▼") : "");
  const ariaSort = (id: ColumnId) =>
    sort?.id === id ? (sort.dir === 1 ? ("ascending" as const) : ("descending" as const)) : ("none" as const);

  return (
    <table className="orders">
      <thead>
        <tr>
          {COLUMNS.map((col) => (
            <th key={col.id} aria-sort={ariaSort(col.id)}>
              <button type="button" className="orders__sort" title="Click to sort" onClick={() => setSort(nextSort(sort, col.id))}>
                {col.label}
                {arrow(col.id)}
              </button>
              <input
                className="orders__filter"
                value={filters[col.id] ?? ""}
                placeholder="filter…"
                aria-label={`Filter ${col.label}`}
                onChange={(e) => setFilters((f) => ({ ...f, [col.id]: e.target.value }))}
              />
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {view.map((r, i) => (
          <tr key={`${r.so_number}-${r.item_no}-${i}`} className={r.health === "red" ? "row row--red" : "row row--yellow"}>
            <td className="mono strong nowrap">{r.so_number}</td>
            <td className="cust">
              {r.customer_name ? (
                <span className="truncate" title={r.customer_name}>
                  {r.customer_name}
                </span>
              ) : (
                <span className="muted">—</span>
              )}
            </td>
            <td>{r.series && <span className="pill pill--blue">{r.series}</span>}</td>
            <td className={r.delivery_date && r.delivery_date < today ? "nowrap overdue" : "nowrap"}>
              {formatShortDate(r.delivery_date)}
            </td>
            <td className="mono right">{formatUnits(r.quantity)}</td>
            <td className="mono right">{formatMoney(rowValue(r))}</td>
            <td>
              <span className={r.health === "red" ? "pill pill--red" : "pill pill--yellow"}>{statusLabel(r)}</span>
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={7} className="empty">
              All orders healthy. 🎉
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
