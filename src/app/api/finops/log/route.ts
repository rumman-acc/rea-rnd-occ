import { handle } from "@/server/http";
import { listLog } from "@/server/modules/finance/finops";

export const GET = handle(({ store, url }) => listLog(store, url.searchParams.get("limit"), url.searchParams.get("process")));
