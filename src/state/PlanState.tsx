"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useDataProvider, type SimNewOrder, type SimOverride } from "@/data/provider";
import type { Kpis, Plan, StatusRow } from "@/domain/types";

/**
 * Shared plan state, held above the routes so navigation does not reload it
 * (SPEC FR-005a). Includes simulation mode: while it is on, `effective` carries the
 * simulated plan and nothing is saved (SPEC-FULL, supersedes dashboard FR-009a).
 */
export interface PlanState {
  /** The base plan from the server. */
  plan: Plan | null;
  loading: boolean;
  error: string | null;
  /** Re-request the plan from the provider with `refresh: true` (SPEC FR-005). */
  refresh: () => Promise<void>;

  simMode: boolean;
  simOverrides: SimOverride[];
  simNewOrders: SimNewOrder[];
  simResult: Plan | null;
  simBusy: boolean;
  setSimMode: (on: boolean) => void;
  /** Add or replace the reschedule for `override.po_number`, then re-simulate. */
  addSimOverride: (override: SimOverride) => Promise<void>;
  setSimNewOrders: (orders: SimNewOrder[]) => Promise<void>;
  /** Leave simulation mode and drop everything simulated. */
  discardSim: () => void;
  /** What pages should display: the simulated plan in simulation mode, else the base plan. */
  effective: { kpis: Kpis | null; status_board: StatusRow[]; capacity: unknown[] };
}

const PlanStateContext = createContext<PlanState | null>(null);

export function PlanStateProvider({ children }: { children: ReactNode }) {
  const provider = useDataProvider();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const [simMode, setSimModeState] = useState(false);
  const [simOverrides, setSimOverrides] = useState<SimOverride[]>([]);
  const [simNewOrders, setSimNewOrdersState] = useState<SimNewOrder[]>([]);
  const [simResult, setSimResult] = useState<Plan | null>(null);
  const [simBusy, setSimBusy] = useState(false);

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true);
      setError(null);
      try {
        setPlan(await provider.getPlan({ refresh }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [provider],
  );

  useEffect(() => {
    // Guard against the duplicate effect run of React StrictMode in development,
    // so the provider receives exactly one initial request (SPEC AC-002).
    if (started.current) return;
    started.current = true;
    void load(false);
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  const runSim = useCallback(
    async (overrides: SimOverride[], newOrders: SimNewOrder[]) => {
      setSimBusy(true);
      try {
        if (overrides.length === 0 && newOrders.length === 0) setSimResult(null);
        else setSimResult(await provider.simulate({ overrides, assembler_overrides: {}, new_orders: newOrders }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSimBusy(false);
      }
    },
    [provider],
  );

  const setSimMode = useCallback((on: boolean) => {
    setSimModeState(on);
    if (!on) {
      setSimOverrides([]);
      setSimNewOrdersState([]);
      setSimResult(null);
    }
  }, []);

  const addSimOverride = useCallback(
    async (o: SimOverride) => {
      const next = [...simOverrides.filter((x) => x.po_number !== o.po_number), o];
      setSimOverrides(next);
      await runSim(next, simNewOrders);
    },
    [simOverrides, simNewOrders, runSim],
  );

  const setSimNewOrders = useCallback(
    async (orders: SimNewOrder[]) => {
      setSimNewOrdersState(orders);
      // Overrides of simulated ("SIM-") orders that no longer exist are dropped.
      const names = new Set(orders.map((o) => o.name));
      const kept = simOverrides.filter((o) => !o.po_number.startsWith("SIM-") || names.has(o.po_number));
      setSimOverrides(kept);
      await runSim(kept, orders);
    },
    [simOverrides, runSim],
  );

  const discardSim = useCallback(() => setSimMode(false), [setSimMode]);

  const effective = useMemo(() => {
    const src = simMode && simResult ? simResult : plan;
    return { kpis: src?.kpis ?? null, status_board: src?.status_board ?? [], capacity: src?.capacity ?? [] };
  }, [plan, simMode, simResult]);

  const value = useMemo<PlanState>(
    () => ({
      plan, loading, error, refresh,
      simMode, simOverrides, simNewOrders, simResult, simBusy,
      setSimMode, addSimOverride, setSimNewOrders, discardSim, effective,
    }),
    [plan, loading, error, refresh, simMode, simOverrides, simNewOrders, simResult, simBusy, setSimMode, addSimOverride, setSimNewOrders, discardSim, effective],
  );
  return <PlanStateContext.Provider value={value}>{children}</PlanStateContext.Provider>;
}

export function usePlan(): PlanState {
  const v = useContext(PlanStateContext);
  if (!v) throw new Error("usePlan must be used inside <PlanStateProvider>");
  return v;
}
