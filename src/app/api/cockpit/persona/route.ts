import { handle } from "@/server/http";
import { getPersona, putPersona } from "@/server/modules/purchasing/persona";

export const GET = handle(({ store }) => getPersona(store));
export const PUT = handle(async (c) => putPersona(c.store, c.actor, await c.json()));
