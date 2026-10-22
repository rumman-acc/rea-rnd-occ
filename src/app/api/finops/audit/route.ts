import { handle } from "@/server/http";
import { listFindings } from "@/server/modules/finance/finops";

export const GET = handle(({ store, url }) => listFindings(store, url.searchParams.get("status")));
