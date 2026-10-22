import { handle } from "@/server/http";
import { restoreBackup } from "@/server/modules/admin/backups";
import { requireAdmin } from "@/server/modules/admin/guard";

export const POST = handle<{ id: string }>(async (c) => {
  requireAdmin(c);
  const body = await c.json<{ operator?: unknown }>();
  const operator = typeof body.operator === "string" && body.operator.trim() ? body.operator.trim() : c.actor;
  return { ok: true, restored: restoreBackup(c.store, operator, c.params.id) };
});
