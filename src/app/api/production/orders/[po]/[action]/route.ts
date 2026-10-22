import { badRequest, handle, notFound } from "@/server/http";
import { finishOrder, releaseOrder, rescheduleOrder, setProgress } from "@/server/modules/production/schedule";

export const POST = handle<{ po: string; action: string }>(async (c) => {
  const { po, action } = c.params;
  switch (action) {
    case "release":
      return releaseOrder(c.store, c.actor, po);
    case "finish":
      return finishOrder(c.store, c.actor, po);
    case "reschedule":
      return rescheduleOrder(c.store, c.actor, po, await c.json());
    case "progress":
      return setProgress(c.store, c.actor, po, await c.json());
    default:
      throw action ? notFound(`unknown action ${action}`) : badRequest("action required");
  }
});
