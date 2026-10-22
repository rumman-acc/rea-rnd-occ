import { handle } from "@/server/http";
import { getSettings, putSettings } from "@/server/modules/warehouse/service";

export const GET = handle(({ store }) => getSettings(store));
export const PUT = handle(async ({ store, actor, json }) => putSettings(store, await json(), actor));
