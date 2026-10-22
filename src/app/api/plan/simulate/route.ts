import { handle } from "@/server/http";
import { simulatePlan, type SimulateInput } from "@/server/simulate";

export const POST = handle(async (c) => {
  const body = await c.json<Partial<SimulateInput>>();
  return simulatePlan(c.store, {
    overrides: body.overrides ?? [],
    assembler_overrides: body.assembler_overrides ?? {},
    new_orders: body.new_orders ?? [],
  });
});
