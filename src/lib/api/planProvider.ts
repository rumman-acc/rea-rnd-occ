import type { PlanProvider } from "@/data/provider";
import type { Plan, VersionInfo } from "@/domain/types";
import { get, post } from "./request";

/** PlanProvider backed by this app's own /api routes. */
export function createHttpPlanProvider(): PlanProvider {
  return {
    getPlan: ({ refresh }) => get<Plan>(`/api/plan${refresh ? "?refresh=true" : ""}`),
    getVersion: () => get<VersionInfo>("/api/version"),
    simulate: (input) => post<Plan>("/api/plan/simulate", input),
  };
}
