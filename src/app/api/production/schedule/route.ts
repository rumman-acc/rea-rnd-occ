import { handle } from "@/server/http";
import { scheduleView } from "@/server/modules/production/schedule";
import { simulatedStore, type SimulateInput } from "@/server/simulate";

export const GET = handle(({ store }) => scheduleView(store));
export const POST = handle(async (c) => {
  const b = await c.json<Partial<SimulateInput>>();
  return scheduleView(simulatedStore(c.store, { overrides: b.overrides ?? [], new_orders: b.new_orders ?? [] }), c.store);
});
