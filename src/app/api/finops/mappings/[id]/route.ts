import { handle } from "@/server/http";
import { deleteMapping } from "@/server/modules/finance/finops";

export const DELETE = handle<{ id: string }>(({ store, params, actor }) => deleteMapping(store, params.id, actor));
