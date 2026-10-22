import { handle } from "@/server/http";
import { who } from "@/server/modules/ai/core";
import { controlRun } from "@/server/modules/ai/agents";

export const POST = handle<{ id: string; action: string }>(async ({ store, params, json, actor }) => controlRun(store, params.id, params.action, who(await json(), actor)));
