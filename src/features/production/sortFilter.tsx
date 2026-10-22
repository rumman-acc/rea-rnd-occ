"use client";

import { useMemo, useState, type ReactNode } from "react";

/** Column definition: `get` is the raw value used for filtering (substring) and sorting. */
export interface Col<T> {
  get: (row: T) => string | number | null | undefined;
  numeric?: boolean;
  filter?: boolean;
}

export interface SortFilter<T> {
  view: T[];
  sort: { id: string; dir: 1 | -1 } | null;
  filters: Record<string, string>;
  cols: Record<string, Col<T>>;
  toggle: (id: string) => void;
  setFilter: (id: string, v: string) => void;
}

/** Same behaviour as the original table hook (PRD-UI-004): raw-value filters, single-column sort. */
export function useSortFilter<T>(rows: T[], cols: Record<string, Col<T>>): SortFilter<T> {
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
        col.numeric
          ? ((Number(col.get(a)) || 0) - (Number(col.get(b)) || 0)) * sort.dir
          : String(col.get(a) ?? "").localeCompare(String(col.get(b) ?? "")) * sort.dir,
      );
    }
    return out;
    // cols are rebuilt each render but only close over constants
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, filters]);
  return {
    view,
    sort,
    filters,
    cols,
    toggle: (id) => setSort((s) => (s?.id === id ? (s.dir === 1 ? { id, dir: -1 } : null) : { id, dir: 1 })),
    setFilter: (id, v) => setFilters((f) => ({ ...f, [id]: v })),
  };
}

export function Th<T>({ sf, id, label, right }: { sf: SortFilter<T>; id: string; label: string; right?: boolean }) {
  const col = sf.cols[id];
  const arrow = sf.sort?.id === id ? (sf.sort.dir === 1 ? " ▲" : " ▼") : "";
  return (
    <th className={right ? "right" : undefined}>
      <button type="button" className="orders__sort" title="Click to sort" onClick={() => sf.toggle(id)}>
        {label}
        {arrow}
      </button>
      {col?.filter !== false && (
        <input
          className="orders__filter"
          value={sf.filters[id] ?? ""}
          placeholder="filter…"
          aria-label={`Filter ${label}`}
          onChange={(e) => sf.setFilter(id, e.target.value)}
        />
      )}
    </th>
  );
}

export function TableCard({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="table-scroll">
        <table className="dt prd-table">
          <thead>
            <tr>{head}</tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </section>
  );
}
