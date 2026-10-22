"use client";

import { createContext, useContext, type ReactNode } from "react";

/** Injectable clock, locale and time zone (SPEC ARC-008). */
export interface Runtime {
  now: () => Date;
  /** Locale for time-of-day text; the original used the browser default. */
  locale: string | undefined;
  /** IANA time zone; undefined means the viewer's own zone. */
  timeZone: string | undefined;
}

export const defaultRuntime: Runtime = {
  now: () => new Date(),
  locale: undefined,
  timeZone: undefined,
};

const RuntimeContext = createContext<Runtime>(defaultRuntime);

export function RuntimeProvider({ value, children }: { value: Runtime; children: ReactNode }) {
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useRuntime(): Runtime {
  return useContext(RuntimeContext);
}
