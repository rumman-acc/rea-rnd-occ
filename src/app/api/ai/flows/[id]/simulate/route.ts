import { handle } from "@/server/http";
import { who } from "@/server/modules/ai/core";
import { simulateFlow } from "@/server/modules/ai/flows";

export const POST = handle<{ id: string }>(async ({ store, params, json, actor }) => ({ run: simulateFlow(store, params.id, who(await json(), actor)) }));
