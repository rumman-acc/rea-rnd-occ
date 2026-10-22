import { handle } from "@/server/http";
import { putLaborRates } from "@/server/modules/production/costing";

export const PUT = handle(async (c) => putLaborRates(c.store, c.actor, await c.json()));
