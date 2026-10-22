import { handle } from "@/server/http";
import { who } from "@/server/modules/ai/core";
import { CATALOG, listFlows, saveFlow } from "@/server/modules/ai/flows";

export const GET = handle(({ store }) => ({ flows: listFlows(store), catalog: CATALOG }));

export const PUT = handle(async ({ store, json, actor }) => {
  const b = await json();
  return saveFlow(store, b, who(b, actor));
});
