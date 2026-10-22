import { handle } from "@/server/http";
import { postReceipt } from "@/server/modules/warehouse/service";

export const POST = handle(async ({ store, actor, json }) => postReceipt(store, await json(), actor));
