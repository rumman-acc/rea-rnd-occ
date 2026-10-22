import { handle } from "@/server/http";
import { putHeadcounts } from "@/server/modules/production/capacity";

export const PUT = handle(async (c) => putHeadcounts(c.store, c.actor, await c.json()));
