import { handle } from "@/server/http";
import { pricing } from "@/server/modules/pricing/routes";

export const DELETE = handle((c) => pricing("purchase").deleteJob(c));
