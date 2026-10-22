import { handle } from "@/server/http";
import { sync } from "@/server/modules/finance/gl";

// POST /api/finance/sync with body { full }: simulated connector that rebuilds the ledger from master data.
export const POST = handle(async (c) => sync(c.store, (await c.json<{ full?: unknown }>()).full, c.actor));
