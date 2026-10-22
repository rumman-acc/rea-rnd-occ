import { handle } from "@/server/http";
import { deleteBackup } from "@/server/modules/admin/backups";
import { requireAdmin } from "@/server/modules/admin/guard";

export const DELETE = handle<{ id: string }>((c) => {
  requireAdmin(c);
  deleteBackup(c.store, c.actor, c.params.id);
  return { ok: true };
});
