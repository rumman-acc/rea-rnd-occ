import type { Plan, VersionInfo } from "@/domain/types";
import { FX_PLAN, FX_VERSION } from "./fixtures";
import type { PlanProvider, SimulateInput } from "./provider";

/**
 * Deterministic local demo provider (SPEC ARC-005, DAT-003). Used by tests and as a
 * network-free provider; the running app uses the HTTP provider.
 *
 * No network I/O, no randomness, no wall-clock reads, no module-level mutable state.
 * Each call returns a fresh deep copy. `refresh` has no effect on the data (SPEC OQ-010).
 */
export function createDemoProvider(): PlanProvider {
  return {
    async getPlan(_options: { refresh: boolean }): Promise<Plan> {
      return structuredClone(FX_PLAN) as Plan;
    },
    async getVersion(): Promise<VersionInfo> {
      return { version: FX_VERSION };
    },
    async simulate(_input: SimulateInput): Promise<Plan> {
      return structuredClone(FX_PLAN) as Plan;
    },
  };
}
