import { handle } from "@/server/http";
import { getBudget, saveBudget } from "@/server/modules/finance/reports";

export const GET = handle(({ store, url }) => getBudget(store, url.searchParams.get("year")));
export const PUT = handle(async (c) => {
  const b = await c.json<{ year?: unknown; entries?: unknown }>();
  return saveBudget(c.store, b.year, b.entries, c.actor);
});
