import { handle } from "@/server/http";
import { who } from "@/server/modules/ai/core";
import { startRun } from "@/server/modules/ai/agents";

export const POST = handle<{ name: string }>(async ({ store, params, json, actor }) => startRun(store, params.name, who(await json(), actor)));
