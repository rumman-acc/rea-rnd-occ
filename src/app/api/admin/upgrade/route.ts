import { handle } from "@/server/http";
import { requireAdmin } from "@/server/modules/admin/guard";
import { startUpgrade } from "@/server/modules/admin/releases";

export const POST = handle(async (c) => {
  requireAdmin(c);
  return startUpgrade(c.store, c.actor, await c.json());
});
