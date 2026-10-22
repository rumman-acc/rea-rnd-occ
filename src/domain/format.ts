import type { Runtime } from "@/runtime/runtime";

// Number and date text formatting per SPEC KPI-015 / TBL-006.

export function formatMoney(v: number | null | undefined): string {
  return v == null ? "—" : "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function formatUnits(v: number | null | undefined): string {
  return v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

/** "Mon D" from an ISO date or datetime string; "—" when absent. No year. */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Today as "YYYY-MM-DD" in the runtime's time zone (used for the overdue highlight). */
export function todayIso(rt: Runtime): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: rt.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(rt.now());
}

/** "Monday, October 19, 2026" */
export function formatLongDate(rt: Runtime): string {
  return rt.now().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: rt.timeZone,
  });
}

const ZONE_DESIGNATOR = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Time-of-day text for the header's "as of" (SPEC FR-004a, AS-07).
 * A zone-less timestamp is treated as wall-clock time and shown as written;
 * a timestamp with a zone designator is shown in the runtime's time zone.
 */
export function formatClockTime(iso: string, rt: Runtime): string {
  if (!ZONE_DESIGNATOR.test(iso)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(iso);
    if (m) {
      const [, y, mo, d, h, mi, s] = m;
      const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0));
      return date.toLocaleTimeString(rt.locale, { timeZone: "UTC" });
    }
  }
  return new Date(iso).toLocaleTimeString(rt.locale, { timeZone: rt.timeZone });
}
