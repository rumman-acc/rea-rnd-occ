// Injectable server clock so tests and seeds are deterministic (SPEC-FULL ARC-F02).

type ClockHolder = { __occClock?: () => Date };

export function now(): Date {
  const c = (globalThis as ClockHolder).__occClock;
  return c ? c() : new Date();
}

export function nowIso(): string {
  return now().toISOString();
}

/** Today as YYYY-MM-DD (UTC). */
export function todayIsoDate(): string {
  return nowIso().slice(0, 10);
}

/** Override the clock (tests). Pass undefined to restore the real clock. */
export function setClock(fn: (() => Date) | undefined): void {
  (globalThis as ClockHolder).__occClock = fn;
}
