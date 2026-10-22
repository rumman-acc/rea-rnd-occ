import { listAudit } from "@/server/audit";
import { handle, intParam } from "@/server/http";
import { requireAdmin } from "@/server/modules/admin/guard";

export const GET = handle((c) => {
  requireAdmin(c);
  const source = c.url.searchParams.get("source") || undefined;
  const q = c.url.searchParams.get("q") || undefined;
  const limit = Math.min(Math.max(intParam(c.url, "limit", 200), 1), 1000);
  const sources = [...new Set(listAudit(c.store).map((e) => e.source))].sort();
  return { entries: listAudit(c.store, { source, q, limit }), sources };
});
