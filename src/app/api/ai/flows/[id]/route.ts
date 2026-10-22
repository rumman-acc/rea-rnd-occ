import { handle } from "@/server/http";
import { deleteFlow } from "@/server/modules/ai/flows";

export const DELETE = handle<{ id: string }>(({ store, params, actor }) => {
  deleteFlow(store, params.id, actor);
  return { ok: true };
});
