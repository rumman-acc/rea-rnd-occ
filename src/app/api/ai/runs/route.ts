import { handle } from "@/server/http";
import { listRuns } from "@/server/modules/ai/core";

// Pure read. Simulated progress is advanced by POST /api/ai/runs/tick (spec REQ-AI-AGT-003).
export const GET = handle(({ store }) => listRuns(store));
