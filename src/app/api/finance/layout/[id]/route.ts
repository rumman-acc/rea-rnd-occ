import { handle } from "@/server/http";
import { getLayout, saveLayout } from "@/server/modules/finance/reports";

export const GET = handle<{ id: string }>(({ store, params }) => getLayout(store, params.id));
// PUT body { layout, actor } (request shape as in the original client)
export const PUT = handle<{ id: string }>(async (c) => {
  const b = await c.json<{ layout?: unknown; actor?: unknown }>();
  return saveLayout(c.store, c.params.id, b.layout, typeof b.actor === "string" && b.actor.trim() ? b.actor.trim() : c.actor);
});
