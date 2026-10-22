import type { Plan } from "@/domain/types";
import { badRequest, notFound } from "./http";
import { MASTER_KEYS, master, type MasterData } from "./master";
import { computePlan } from "./plan";
import { capacityRows, parseHeadcounts } from "./modules/production/capacity";
import { addOrder, applyReschedule, parseNewOrder } from "./modules/production/schedule";
import { createMemoryStore, type Store } from "./store";

export interface SimulateInput {
  /**
   * Reschedules of existing production orders (our definition, SPEC production REQ-SIM-003):
   * { po_number, start_date?, end_date? } with YYYY-MM-DD dates.
   */
  overrides: Array<{ po_number: string } & Record<string, unknown>>;
  /** Headcount overrides per work center, { "WC-ASM": 3 }; affect only the simulated capacity rows. */
  assembler_overrides: Record<string, unknown>;
  /**
   * Hypothetical new production orders (REQ-SIM-004):
   * { name, fg_item_no, quantity, so_number?, start_date, end_date }.
   */
  new_orders: Array<{ name: string } & Record<string, unknown>>;
}

/** A throw-away copy of the store with the overrides and new orders applied. The real store is never written to. */
export function simulatedStore(store: Store, input: Pick<SimulateInput, "overrides" | "new_orders">): Store {
  // Read through master() so lazily seeded collections are materialised before copying.
  for (const name of Object.keys(MASTER_KEYS) as Array<keyof MasterData>) master(store, name);
  const tmp = createMemoryStore();
  tmp.restore(store.snapshot());
  const taken = new Set(master(tmp, "production_orders").map((p) => p.po_number));
  const newOrders = Array.isArray(input.new_orders) ? input.new_orders : [];
  for (const raw of newOrders) {
    const o = parseNewOrder(tmp, raw, taken);
    taken.add(o.name);
    addOrder(tmp, o, o.name);
  }
  const overrides = Array.isArray(input.overrides) ? input.overrides : [];
  for (const o of overrides) {
    if (!o || typeof o.po_number !== "string") throw badRequest("override.po_number is required");
    if (!taken.has(o.po_number)) throw notFound(`production order ${o.po_number} not found`);
    applyReschedule(tmp, o.po_number, o);
  }
  return tmp;
}

/** Simulated plan for POST /api/plan/simulate. Nothing is saved. */
export function simulatePlan(store: Store, input: SimulateInput): Plan {
  const tmp = simulatedStore(store, input);
  const headcounts = parseHeadcounts(tmp, input.assembler_overrides ?? {}, "assembler_overrides");
  const plan = computePlan(tmp);
  plan.capacity = capacityRows(tmp, headcounts);
  return plan;
}
