import { handle } from "@/server/http";
import { requireAdmin } from "@/server/modules/admin/guard";
import { integrations } from "@/server/modules/admin/misc";

export const GET = handle((c) => {
  requireAdmin(c);
  return { integrations: integrations() };
});
