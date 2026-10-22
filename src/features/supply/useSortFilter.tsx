"use client";

import { useMemo, useState, type ReactNode } from "react";

export interface ColSpec<T> {
  get: (row: T) => string | number | null | undefined;
  numeric?: boolean;
  sort?: boolean;
  filter?: boolean;
}
export interface SortFilter<T> {
  view: T[];
  sort: { id: string; dir: 1 | -1 } | null;
  filters: Record<string, string>;
  cols: Record<string, ColSpec<T>>;
  toggle: (id: string) => void;
  setFilter: (id: string, v: string) => void;
}

/** Per-column filter (case-insensitive substring on the raw text) and single-column sort. */
export function useSortFilter<T>(rows: T[], cols: Record<string, ColSpec<T>>): SortFilter<T> {
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 } | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const view = useMemo(() => {
    let out = rows;
    for (const [id, c] of Object.entries(cols)) {
      const needle = (filters[id] ?? "").trim().toLowerCase();
      if (needle) out = out.filter((r) => String(c.get(r) ?? "").toLowerCase().includes(needle));
    }
    if (sort && cols[sort.id]) {
      const c = cols[sort.id];
      out = [...out].sort((a, b) =>
        c.numeric
          ? ((Number(c.get(a)) || 0) - (Number(c.get(b)) || 0)) * sort.dir
          : String(c.get(a) ?? "").localeCompare(String(c.get(b) ?? "")) * sort.dir,
      );
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, filters]);
  return {
    view, sort, filters, cols,
    toggle: (id) => setSort((s) => (s?.id === id ? (s.dir === 1 ? { id, dir: -1 } : null) : { id, dir: 1 })),
    setFilter: (id, v) => setFilters((f) => ({ ...f, [id]: v })),
  };
}

export function SfTh<T>({ sf, id, label }: { sf: SortFilter<T>; id: string; label: string }) {
  const spec = sf.cols[id];
  const sortable = spec?.sort !== false;
  const filterable = spec?.filter !== false;
  const arrow = sf.sort?.id === id ? (sf.sort.dir === 1 ? " ▲" : " ▼") : "";
  return (
    <th>
      <button type="button" className="sx-sort" disabled={!sortable} title={sortable ? "Click to sort" : undefined} onClick={() => sf.toggle(id)}>
        {label}
        {arrow}
      </button>
      {filterable && (
        <input
          className="sx-filter"
          value={sf.filters[id] ?? ""}
          placeholder="filter…"
          aria-label={`Filter ${label}`}
          onChange={(e) => sf.setFilter(id, e.target.value)}
        />
      )}
    </th>
  );
}

/** Rows hold arrays or objects: wrap so the memo key is stable. */
export type { ReactNode };
