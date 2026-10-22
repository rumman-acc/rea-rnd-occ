import { listUsers } from "@/server/auth";
import { handle } from "@/server/http";
import { requireAdmin } from "@/server/modules/admin/guard";

export const GET = handle((c) => {
  requireAdmin(c);
  return { users: listUsers(c.store) };
});
