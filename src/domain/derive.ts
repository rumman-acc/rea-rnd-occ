import type { Health, StatusRow } from "./types";

// Pure derivations over `status_board` (SPEC ARC-007, DAT-004).
// KPI cards are never derived from rows (SPEC KPI-011).

export type HealthCounts = Record<Health, number>;

export function healthCounts(rows: readonly StatusRow[]): HealthCounts {
  const counts: HealthCounts = { green: 0, yellow: 0, red: 0 };
  for (const r of rows) counts[r.health]++;
  return counts;
}

/** Rows whose health is not green, in provider order (SPEC TBL-004). */
export function atRiskRows(rows: readonly StatusRow[]): StatusRow[] {
  return rows.filter((r) => r.health !== "green");
}

/** Sidebar badge: count of red rows (SPEC FR-013a). */
export function redCount(rows: readonly StatusRow[]): number {
  return rows.filter((r) => r.health === "red").length;
}

const SEVERITY: Record<Health, number> = { green: 0, yellow: 1, red: 2 };

export interface SeriesSummary {
  series: string;
  total: number;
  worst: Health;
}

/**
 * Per-series totals and worst health. No series is grouped as "other".
 * Order is the string order of the series key (SPEC CHT-011): the original
 * used the default JavaScript sort of [series, total] pairs.
 */
export function seriesSummaries(rows: readonly StatusRow[]): SeriesSummary[] {
  const map = new Map<string, { total: number; worst: Health }>();
  for (const r of rows) {
    const key = r.series || "other";
    const cur = map.get(key) ?? { total: 0, worst: "green" as Health };
    cur.total += r.quantity;
    if (SEVERITY[r.health] > SEVERITY[cur.worst]) cur.worst = r.health;
    map.set(key, cur);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([series, v]) => ({ series, total: v.total, worst: v.worst }));
}

export type KpiTone = "blue" | "green" | "amber" | "red";

// Tone thresholds verified in the original's code (SPEC KPI-014).
export function onTimeTone(pct: number): KpiTone {
  return pct >= 90 ? "green" : pct >= 75 ? "amber" : "red";
}
export function linkedTone(pct: number): KpiTone {
  return pct >= 90 ? "green" : pct >= 60 ? "amber" : "red";
}
export function criticalTone(n: number): KpiTone {
  return n === 0 ? "green" : n <= 5 ? "amber" : "red";
}
