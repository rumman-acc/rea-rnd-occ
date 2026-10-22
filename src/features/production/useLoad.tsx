"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Load async data; `reload()` refetches. Errors become strings. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await fnRef.current();
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError(errText(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload };
}

/** Error text of an API failure: the server's `detail` when present. */
export function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const i = m.indexOf("{");
  if (i >= 0) {
    try {
      const d = (JSON.parse(m.slice(i)) as { detail?: string }).detail;
      if (d) return d;
    } catch {
      /* keep m */
    }
  }
  return m;
}

export function EvidenceNotice() {
  return (
    <div className="notice notice--evidence" role="note">
      Reconstruction: this screen has no original reference; layout and rules are our own design.
    </div>
  );
}
