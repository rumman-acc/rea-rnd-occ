import { handle } from "@/server/http";
import { pricing } from "@/server/modules/pricing/routes";

export const GET = handle((c) => pricing("purchase").settings(c));
export const PUT = handle((c) => pricing("purchase").saveSettings(c));
