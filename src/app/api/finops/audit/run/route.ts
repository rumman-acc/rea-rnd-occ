import { handle } from "@/server/http";
import { runAudit } from "@/server/modules/finance/finops";

export const POST = handle(async (c) => runAudit(c.store, await c.json(), c.actor));
