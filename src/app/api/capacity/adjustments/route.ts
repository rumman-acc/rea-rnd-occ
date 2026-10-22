import { handle } from "@/server/http";
import { addAdjustment } from "@/server/modules/production/capacity";

export const POST = handle(async (c) => addAdjustment(c.store, c.actor, await c.json()));
