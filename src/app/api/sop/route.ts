import { handle } from "@/server/http";
import { buildSop } from "@/server/modules/sop/sop";

// GET /api/sop: rolling 6-month demand / supply / plan sheet plus rule-based insights.
export const GET = handle(({ store }) => buildSop(store));
