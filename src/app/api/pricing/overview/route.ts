import { handle } from "@/server/http";
import { pricing } from "@/server/modules/pricing/routes";

export const GET = handle((c) => pricing("sales").overview(c));
