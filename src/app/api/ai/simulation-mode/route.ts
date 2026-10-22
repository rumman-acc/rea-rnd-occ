import { handle } from "@/server/http";
import { who } from "@/server/modules/ai/core";
import { setSimulationMode } from "@/server/modules/ai/inbox";

export const PUT = handle(async ({ store, json, actor }) => {
  const b = await json();
  return setSimulationMode(store, b, who(b, actor));
});
