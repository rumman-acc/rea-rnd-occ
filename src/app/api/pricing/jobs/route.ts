import { handle } from "@/server/http";
import { pricing } from "@/server/modules/pricing/routes";

export const GET = handle((c) => pricing("sales").jobs(c));
export const PUT = handle((c) => pricing("sales").saveJob(c));
