import { getSessionUser } from "@/server/auth";
import { forbidden, type Ctx } from "@/server/http";

/** Admin-only actions need the "Admin" role when a session cookie is present. No session at all (in-process tests) is allowed (P). */
export function requireAdmin(c: Pick<Ctx, "req">): void {
  const user = getSessionUser(c.req);
  if (user && user.role !== "Admin") throw forbidden("Admin role required");
}
