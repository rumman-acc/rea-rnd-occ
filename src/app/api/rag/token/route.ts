import { handle } from "@/server/http";

// GET /api/rag/token: stub. There is no token service; the cockpit ignores the value (spec REQ-AI-API-005).
export const GET = handle(() => ({ token: "demo-stub-token", stub: true }));
