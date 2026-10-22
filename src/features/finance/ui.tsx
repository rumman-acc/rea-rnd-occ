"use client";

import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import "./finance.css";

export const money = (n: number) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
export const money2 = (n: number) => (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function Loading({ text }: { text: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={18} /> {text}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="notice notice--bad fin-err" role="alert">
      {message}
    </div>
  );
}

export function EvidenceNotice({ children }: { children: ReactNode }) {
  return (
    <p className="notice notice--evidence fin-notice" data-testid="evidence-notice">
      {children}
    </p>
  );
}

/** Load async data; `reload` re-runs it. Keeps the previous data visible while reloading. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await run());
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [run]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, loading, reload };
}

export function Table({ head, rows, empty, numeric = [] }: { head: string[]; rows: ReactNode[][]; empty: string; numeric?: number[] }) {
  return (
    <div className="table-scroll">
      <table className="dt">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={`${h}-${i}`} className={numeric.includes(i) ? "num" : undefined}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={head.length}>{empty}</td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className={numeric.includes(j) ? "num" : undefined}>
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly T[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t} role="tab" aria-selected={t === value} className={t === value ? "tab tab--active" : "tab"} onClick={() => onChange(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}

export function Pill({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return <span className={ok ? "pill pill--green" : "pill pill--red"}>{ok ? yes : no}</span>;
}
