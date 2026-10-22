import { handle } from "@/server/http";
import { postMovement } from "@/server/modules/warehouse/service";

export const POST = handle(async ({ store, actor, json }) => postMovement(store, await json(), actor));
