import { badRequest, handle } from "@/server/http";
import { deleteAdjustment } from "@/server/modules/production/capacity";

export const DELETE = handle<{ id: string }>((c) => {
  const id = Number(c.params.id);
  if (!Number.isInteger(id)) throw badRequest("adjustment id must be an integer");
  deleteAdjustment(c.store, c.actor, id);
  return { ok: true };
});
