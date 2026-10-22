import { handle } from "@/server/http";
import { requireAdmin } from "@/server/modules/admin/guard";
import { getSettings, saveSettings } from "@/server/modules/admin/settings";

export const GET = handle(({ store }) => getSettings(store));

export const PUT = handle(async (c) => {
  requireAdmin(c);
  return saveSettings(c.store, c.actor, await c.json());
});
