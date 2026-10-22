import { handle } from "@/server/http";
import { createOrder, releasedOrders } from "@/server/modules/production/schedule";

export const GET = handle(({ store }) => releasedOrders(store));
export const POST = handle(async (c) => createOrder(c.store, c.actor, await c.json()));
