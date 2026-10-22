import { handle } from "@/server/http";
import { salesHistory } from "@/server/modules/pricing/routes";

export const GET = handle((c) => salesHistory(c));
