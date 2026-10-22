import { handle } from "@/server/http";
import { costing } from "@/server/modules/production/costing";

export const GET = handle(({ store }) => costing(store));
