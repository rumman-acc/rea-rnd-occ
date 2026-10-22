import type { PlanProvider, SimulateInput } from "@/data/provider";
import type { Plan, VersionInfo } from "@/domain/types";

// Test-support providers (SPEC ARC-006). Not product features.

export interface PlanCall {
  refresh: boolean;
}

export interface ControlledProvider extends PlanProvider {
  /** Every getPlan call, in order. */
  readonly planCalls: PlanCall[];
  /** Every simulate call, in order. */
  readonly simulateCalls: SimulateInput[];
  readonly versionCalls: number;
  /** Reject getPlan (all calls, or only refresh:true calls). */
  failPlan(error: Error, opts?: { refreshOnly?: boolean }): void;
  failVersion(error: Error): void;
  clearFailures(): void;
  /** Hold the next getPlan calls pending until the returned release() is called. */
  hold(): () => void;
}

/** Wrap a provider so tests can inspect calls and inject failure or latency. */
export function controlled(base: PlanProvider): ControlledProvider {
  const planCalls: PlanCall[] = [];
  const simulateCalls: SimulateInput[] = [];
  let versionCalls = 0;
  let planFailure: { error: Error; refreshOnly: boolean } | null = null;
  let versionFailure: Error | null = null;
  let gate: Promise<void> | null = null;

  return {
    planCalls,
    simulateCalls,
    get versionCalls() {
      return versionCalls;
    },
    failPlan(error, opts) {
      planFailure = { error, refreshOnly: opts?.refreshOnly ?? false };
    },
    failVersion(error) {
      versionFailure = error;
    },
    clearFailures() {
      planFailure = null;
      versionFailure = null;
    },
    hold() {
      let release!: () => void;
      gate = new Promise<void>((r) => (release = r));
      return () => {
        release();
        gate = null;
      };
    },
    async getPlan(options): Promise<Plan> {
      planCalls.push({ refresh: options.refresh });
      if (gate) await gate;
      if (planFailure && (!planFailure.refreshOnly || options.refresh)) throw planFailure.error;
      return base.getPlan(options);
    },
    async getVersion(): Promise<VersionInfo> {
      versionCalls++;
      if (versionFailure) throw versionFailure;
      return base.getVersion();
    },
    async simulate(input): Promise<Plan> {
      simulateCalls.push(input);
      return base.simulate(input);
    },
  };
}

/** A stub provider with arbitrary data, for provider-boundary tests. */
export function stubProvider(plan: Plan, version = "0.0.0-stub"): PlanProvider {
  return {
    getPlan: async () => structuredClone(plan),
    getVersion: async () => ({ version }),
    simulate: async () => structuredClone(plan),
  };
}
