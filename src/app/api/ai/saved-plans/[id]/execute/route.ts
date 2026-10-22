import { handle } from "@/server/http";
import { who } from "@/server/modules/ai/core";
import { executePlan } from "@/server/modules/ai/inbox";

export const POST = handle<{ id: string }>(async ({ store, params, json, actor }) => {
  const b = await json();
  return executePlan(store, params.id, b, who(b, actor));
});
