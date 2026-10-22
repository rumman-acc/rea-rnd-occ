import { handle } from "@/server/http";
import { pricing } from "@/server/modules/pricing/routes";

export const POST = handle((c) => pricing("sales").archive(c));
