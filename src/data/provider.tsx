"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Plan, VersionInfo } from "@/domain/types";

export interface SimOverride {
  po_number: string;
  [k: string]: unknown;
}

export interface SimNewOrder {
  name: string;
  [k: string]: unknown;
}

export interface SimulateInput {
  overrides: SimOverride[];
  assembler_overrides: Record<string, unknown>;
  new_orders: SimNewOrder[];
}

/**
 * The data boundary of the dashboard shell (SPEC ARC-003, ARC-004).
 *
 * Production wiring is the HTTP provider (src/lib/api/planProvider.ts) talking to this
 * app's own /api routes; tests and the standalone demo use the demo/stub providers.
 */
export interface PlanProvider {
  getPlan(options: { refresh: boolean }): Promise<Plan>;
  getVersion(): Promise<VersionInfo>;
  /** What-if plan for the given reschedules / new orders. Nothing is saved. */
  simulate(input: SimulateInput): Promise<Plan>;
}

const DataProviderContext = createContext<PlanProvider | null>(null);

export function DataProvider({ provider, children }: { provider: PlanProvider; children: ReactNode }) {
  return <DataProviderContext.Provider value={provider}>{children}</DataProviderContext.Provider>;
}

export function useDataProvider(): PlanProvider {
  const p = useContext(DataProviderContext);
  if (!p) throw new Error("useDataProvider must be used inside <DataProvider>");
  return p;
}
