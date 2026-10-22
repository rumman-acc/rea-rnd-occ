import { handle } from "@/server/http";
import { seedBudget } from "@/server/modules/finance/reports";

export const POST = handle(async (c) => seedBudget(c.store, await c.json(), c.actor));
