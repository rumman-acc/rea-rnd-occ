import { handle } from "@/server/http";
import { listMappings, putMapping } from "@/server/modules/finance/finops";

export const GET = handle(({ store, url }) => listMappings(store, url.searchParams.get("kind")));
export const PUT = handle(async (c) => putMapping(c.store, await c.json(), c.actor));
