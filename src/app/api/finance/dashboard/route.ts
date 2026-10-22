import { handle } from "@/server/http";
import { financeDashboard } from "@/server/modules/finance/reports";

// GET /api/finance/dashboard?year=&month= (both or neither; response shape is our own design)
export const GET = handle(({ store, url }) => financeDashboard(store, url.searchParams.get("year"), url.searchParams.get("month")));
