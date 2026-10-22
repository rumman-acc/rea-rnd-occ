import { handle } from "@/server/http";
import { supplyNetting } from "@/server/modules/supply/netting";

// Proposed endpoint (SPEC supply.md REQ-SUP-API-004): per-order BOM rows and projections.
export const GET = handle(({ store }) => supplyNetting(store));
