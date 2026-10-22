import { handle } from "@/server/http";
import { createBackup, listBackups } from "@/server/modules/admin/backups";
import { requireAdmin } from "@/server/modules/admin/guard";

export const GET = handle((c) => {
  requireAdmin(c);
  return { backups: listBackups(c.store) };
});

export const POST = handle((c) => {
  requireAdmin(c);
  return createBackup(c.store, c.actor);
});
