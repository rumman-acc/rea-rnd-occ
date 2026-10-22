"use client";

import { todayIso } from "@/domain/format";
import { useRuntime } from "@/runtime/runtime";
import { HORIZONS } from "./types";

export function HorizonSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="sx-label" title="How far ahead purchases should cover — 'Auto' picks the tightest horizon that contains the first projected shortfall">
      Buying horizon
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {HORIZONS.map((h) => (
          <option key={h.value} value={h.value}>{h.label}</option>
        ))}
      </select>
    </label>
  );
}

/** Today's date as YYYY-MM-DD from the injected runtime (used in export file names). */
export function useTodayStamp(): string {
  return todayIso(useRuntime());
}
