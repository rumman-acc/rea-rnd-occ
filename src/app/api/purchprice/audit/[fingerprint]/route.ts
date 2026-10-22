import { handle } from "@/server/http";
import { pricing } from "@/server/modules/pricing/routes";

export const PATCH = handle((c) => pricing("purchase").patchFinding(c));
