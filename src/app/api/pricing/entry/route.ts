import { handle } from "@/server/http";
import { pricing } from "@/server/modules/pricing/routes";

export const PUT = handle((c) => pricing("sales").upsertEntry(c));
export const DELETE = handle((c) => pricing("sales").deleteEntry(c));
