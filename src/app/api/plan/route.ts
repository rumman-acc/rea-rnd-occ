import { handle } from "@/server/http";
import { computePlan } from "@/server/plan";

// GET /api/plan[?refresh=true]. The plan is recomputed from the store on every call,
// so `refresh` is accepted for contract parity and has no further effect (SPEC OQ-010).
export const GET = handle(({ store }) => computePlan(store));
