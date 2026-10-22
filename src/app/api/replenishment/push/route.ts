import { handle } from "@/server/http";
import { pushPurchaseOrder } from "@/server/modules/supply/purchase";

export const POST = handle(async (c) => pushPurchaseOrder(c.store, c.actor, await c.json()));
