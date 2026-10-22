import { handle } from "@/server/http";
import { linkage } from "@/server/modules/production/schedule";
import { simulatedStore, type SimulateInput } from "@/server/simulate";

export const GET = handle(({ store }) => linkage(store));
// With a body: the same view for the simulated schedule. Nothing is saved.
export const POST = handle(async (c) => {
  const b = await c.json<Partial<SimulateInput>>();
  return linkage(simulatedStore(c.store, { overrides: b.overrides ?? [], new_orders: b.new_orders ?? [] }));
});
