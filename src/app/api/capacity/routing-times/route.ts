import { handle } from "@/server/http";
import { putRouting, routingView } from "@/server/modules/production/capacity";

export const GET = handle(({ store }) => routingView(store));
export const PUT = handle(async (c) => putRouting(c.store, c.actor, await c.json()));
