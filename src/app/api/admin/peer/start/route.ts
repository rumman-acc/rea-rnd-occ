import { handle } from "@/server/http";
import { requireAdmin } from "@/server/modules/admin/guard";
import { startPeer } from "@/server/modules/admin/misc";

export const POST = handle((c) => {
  requireAdmin(c);
  return startPeer(c.store, c.actor);
});
