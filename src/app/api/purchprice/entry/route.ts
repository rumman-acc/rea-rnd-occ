import { handle } from "@/server/http";
import { pricing } from "@/server/modules/pricing/routes";

export const PUT = handle((c) => pricing("purchase").upsertEntry(c));
export const DELETE = handle((c) => pricing("purchase").deleteEntry(c));
