import { handle } from "@/server/http";
import { putSettings } from "@/server/modules/finance/finops";
import { getSettings, saveSettings } from "@/server/modules/finance/settings";

export const GET = handle(({ store }) => getSettings(store));
// PUT body { operator, values } (request shape as in the original client)
export const PUT = handle(async (c) => {
  const b = await c.json<{ operator?: unknown; values?: unknown }>();
  const operator = typeof b.operator === "string" && b.operator.trim() ? b.operator.trim() : c.actor;
  const out = saveSettings(c.store, b.values, operator);
  putSettings(c.store, b.values, operator);
  return out;
});
