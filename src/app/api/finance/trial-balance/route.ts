import { handle } from "@/server/http";
import { trialBalance } from "@/server/modules/finance/reports";

export const GET = handle(({ store, url }) => trialBalance(store, url.searchParams.get("date_from"), url.searchParams.get("date_to")));
