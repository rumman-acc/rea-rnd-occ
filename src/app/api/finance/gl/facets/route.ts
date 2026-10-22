import { handle } from "@/server/http";
import { facets } from "@/server/modules/finance/gl";

export const GET = handle(({ store }) => facets(store));
