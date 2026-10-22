import { handle } from "@/server/http";
import { who } from "@/server/modules/ai/core";
import { validatePlan } from "@/server/modules/ai/inbox";

export const POST = handle<{ id: string }>(async ({ store, params, json, actor }) => {
  const b = await json();
  return validatePlan(store, params.id, who(b, actor));
});
