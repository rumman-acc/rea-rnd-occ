"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useSession } from "@/state/Session";

// Small UI helpers shared by the pricing views (copied patterns, not shared-shell edits).

export const fmtPrice = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
export const fmtInt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });
export const fmtMoney = (v: number) => "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Name recorded as the operator on every pricing action. */
export function useOperator(): string {
  return useSession().user?.name ?? "demo";
}

export type Tone = "green" | "red" | "yellow" | "blue" | "gray" | "navy" | "purple";

export function Pill({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  const cls = { green: "pill--green", red: "pill--red", yellow: "pill--yellow", blue: "pill--blue", gray: "pill--gray", purple: "pill--purple", navy: "pw-navy" }[tone];
  return (
    <span className={`pill ${cls}`} title={title}>
      {children}
    </span>
  );
}

export function Modal({ title, onClose, footer, children }: { title: string; onClose: () => void; footer: ReactNode; children: ReactNode }) {
  return (
    <div className="pw-overlay" onClick={onClose}>
      <div className="pw-modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="pw-modal__head">
          <h3>{title}</h3>
          <button className="pw-x" aria-label="Close dialog" onClick={onClose}>
            x
          </button>
        </header>
        <div className="pw-modal__body">{children}</div>
        <footer className="pw-modal__foot">{footer}</footer>
      </div>
    </div>
  );
}

export function download(filename: string, lines: string[]): void {
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(lines.join("\n"));
  a.download = filename;
  a.click();
}

export const csvCell = (v: unknown) => `"${String(v ?? "").replace(/"/g, "'")}"`;

export interface Col<T> {
  get: (r: T) => string | number;
  numeric?: boolean;
  nofilter?: boolean;
}

export interface TableState<T> {
  view: T[];
  sort: { id: string; dir: 1 | -1 } | null;
  filters: Record<string, string>;
  cols: Record<string, Col<T>>;
  toggle: (id: string) => void;
  setFilter: (id: string, v: string) => void;
}

/** Single-column sort (none, asc, desc) plus per-column substring filter, like the dashboard table. */
export function useTable<T>(rows: T[], cols: Record<string, Col<T>>): TableState<T> {
  const [sort, setSort] = useState<TableState<T>["sort"]>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const view = useMemo(() => {
    let out = rows;
    for (const [id, c] of Object.entries(cols)) {
      const needle = (filters[id] ?? "").trim().toLowerCase();
      if (needle) out = out.filter((r) => String(c.get(r) ?? "").toLowerCase().includes(needle));
    }
    const sc = sort ? cols[sort.id] : null;
    if (sort && sc) {
      out = [...out].sort((a, b) =>
        sc.numeric ? ((Number(sc.get(a)) || 0) - (Number(sc.get(b)) || 0)) * sort.dir : String(sc.get(a) ?? "").localeCompare(String(sc.get(b) ?? "")) * sort.dir,
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

export function Th<T>({ t, id, label, right }: { t: TableState<T>; id: string; label: string; right?: boolean }) {
  const c = t.cols[id];
  const arrow = t.sort?.id === id ? (t.sort.dir === 1 ? " ▲" : " ▼") : "";
  return (
    <th className={right ? "pw-right" : undefined}>
      <button className="orders__sort" title="Click to sort" onClick={() => t.toggle(id)}>
        {label}
        {arrow}
      </button>
      {!c?.nofilter && (
        <input className="orders__filter" placeholder="filter…" aria-label={`Filter ${label}`} value={t.filters[id] ?? ""} onChange={(e) => t.setFilter(id, e.target.value)} onClick={(e) => e.stopPropagation()} />
      )}
    </th>
  );
}

export function FlagList({ flags }: { flags: { level: string; text: string }[] | undefined }) {
  if (!flags?.length) return <Pill tone="green">clean</Pill>;
  return (
    <div className="pw-flags">
      {flags.map((f, i) => (
        <span key={i} title={f.text} className={f.level === "red" ? "pw-flag pw-flag--red" : "pw-flag pw-flag--yellow"}>
          ! {f.text}
        </span>
      ))}
    </div>
  );
}

export function Notice({ tone, children }: { tone?: "ok" | "bad" | "warn"; children: ReactNode }) {
  return <div className={tone === "bad" ? "notice notice--bad" : tone === "warn" ? "notice notice--warn" : "notice"}>{children}</div>;
}
