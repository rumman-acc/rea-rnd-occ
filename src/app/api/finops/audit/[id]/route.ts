import { handle } from "@/server/http";
import { patchFinding } from "@/server/modules/finance/finops";

export const PATCH = handle<{ id: string }>(async (c) => patchFinding(c.store, c.params.id, await c.json(), c.actor));
