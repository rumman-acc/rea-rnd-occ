import { handle } from "@/server/http";
import { listRunsAndTick } from "@/server/modules/ai/agents";

// Advances every unpaused active simulated run by one stage and returns the runs.
// The cockpit polls this; keeping it a POST means GET /api/ai/runs stays side-effect free.
export const POST = handle(({ store }) => listRunsAndTick(store));
