import { handle } from "@/server/http";
import { who } from "@/server/modules/ai/core";
import { runFlow } from "@/server/modules/ai/flows";

export const POST = handle<{ id: string }>(async ({ store, params, json, actor }) => ({ run: runFlow(store, params.id, who(await json(), actor)) }));
