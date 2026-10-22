import { handle } from "@/server/http";
import { pricing } from "@/server/modules/pricing/routes";

export const POST = handle((c) => pricing("purchase").recheck(c));
