import { badRequest } from "@/server/http";
import type { Store } from "@/server/store";

export interface WorkCenter {
  code: string;
  name: string;
  headcount: number;
  hours_per_shift: number;
  labor_rate: number;
}
/** model (FG item no) -> work center code -> hours per unit */
export type RoutingModels = Record<string, Record<string, number>>;
export interface Adjustment {
  id: number;
  work_center: string;
  start_date: string;
  end_date: string;
  hours_per_day: number;
  reason: string;
}
export interface AdjustmentDoc {
  next_id: number;
  items: Adjustment[];
}
export interface CostSettings {
  overhead_pct: number;
}

export const KEYS = {
  workcenters: "production:workcenters",
  routing: "production:routing",
  adjustments: "production:adjustments",
  progress: "production:progress",
  cost: "production:cost",
} as const;

export const seedWorkCenters = (): WorkCenter[] => [
  { code: "WC-MCH", name: "Machining", headcount: 2, hours_per_shift: 8, labor_rate: 28 },
  { code: "WC-ASM", name: "Assembly", headcount: 2, hours_per_shift: 8, labor_rate: 24 },
  { code: "WC-TST", name: "Test & QA", headcount: 1, hours_per_shift: 8, labor_rate: 32 },
];
export const seedRouting = (): RoutingModels => ({
  "FG-1000": { "WC-MCH": 5, "WC-ASM": 8, "WC-TST": 2 },
  "FG-2000": { "WC-MCH": 4, "WC-ASM": 6, "WC-TST": 2 },
  "FG-3000": { "WC-MCH": 20, "WC-ASM": 30, "WC-TST": 8 },
  "FG-6000": { "WC-MCH": 40, "WC-ASM": 60, "WC-TST": 16 },
});

export const workCenters = (s: Store) => s.get(KEYS.workcenters, seedWorkCenters);
export const routing = (s: Store) => s.get(KEYS.routing, seedRouting);
export const adjustmentDoc = (s: Store) => s.get<AdjustmentDoc>(KEYS.adjustments, () => ({ next_id: 1, items: [] }));
export const progressSeed = (): Record<string, number> => ({ "P-ORD201001": 60, "P-ORD201002": 35, "P-ORD201004": 80 });
export const progress = (s: Store) => s.get(KEYS.progress, progressSeed);
export const costSettings = (s: Store) => s.get<CostSettings>(KEYS.cost, () => ({ overhead_pct: 12 }));

export function requireInt(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw badRequest(`${field} must be an integer between ${min} and ${max}`);
  return v;
}
export function requireNum(v: unknown, field: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw badRequest(`${field} must be a number between ${min} and ${max}`);
  return v;
}
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
