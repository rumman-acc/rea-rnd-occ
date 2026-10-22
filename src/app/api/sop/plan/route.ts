import { handle } from "@/server/http";
import { savePlan } from "@/server/modules/sop/sop";

// PUT /api/sop/plan  { entries: { "<model>_<YYYY-MM>" | "<model>|<item>_<YYYY-MM>": {firm?, flex?} | null } }
export const PUT = handle(async (c) => {
  const body = await c.json<{ entries?: unknown }>();
  return savePlan(c.store, body.entries, c.actor);
});
