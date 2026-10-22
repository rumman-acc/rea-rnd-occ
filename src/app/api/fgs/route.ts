import { handle } from "@/server/http";
import { fgCatalog } from "@/server/modules/supply/netting";

export const GET = handle(({ store }) => fgCatalog(store));
