import { handle } from "@/server/http";
import { documentOf } from "@/server/modules/finance/gl";

export const GET = handle<{ id: string }>(({ store, params }) => documentOf(store, params.id));
