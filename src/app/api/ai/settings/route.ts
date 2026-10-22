import { handle } from "@/server/http";
import { who } from "@/server/modules/ai/core";
import { updateSettings } from "@/server/modules/ai/inbox";

export const PUT = handle(async ({ store, json, actor }) => {
  const b = await json();
  return updateSettings(store, b, who(b, actor));
});
