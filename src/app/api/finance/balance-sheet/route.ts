import { handle } from "@/server/http";
import { balanceSheet } from "@/server/modules/finance/reports";

export const GET = handle(({ store, url }) => balanceSheet(store, url.searchParams.get("as_of")));
