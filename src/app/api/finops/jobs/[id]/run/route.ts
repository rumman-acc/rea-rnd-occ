import { handle } from "@/server/http";
import { runJob } from "@/server/modules/finance/finops";

// POST body { operator } as in the original client; as_of is our optional extra for the simulation.
export const POST = handle<{ id: string }>(async (c) => runJob(c.store, c.params.id, await c.json(), c.actor));
