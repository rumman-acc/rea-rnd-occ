import { handle } from "@/server/http";
import { postPos } from "@/server/modules/purchasing/orders";

export const POST = handle(async (c) => postPos(c.store, c.actor, await c.json()));
