import { badRequest, handle } from "@/server/http";
import { runScenario } from "@/server/modules/production/capacity";

export const POST = handle(async (c) => {
  const b = await c.json();
  if (b.assembler_overrides !== undefined && (typeof b.assembler_overrides !== "object" || b.assembler_overrides === null)) throw badRequest("assembler_overrides must be an object");
  return runScenario(c.store, { granularity: "week", headcounts: b.assembler_overrides ?? {} });
});
