import { handle } from "@/server/http";
import { getBins } from "@/server/modules/warehouse/service";

export const GET = handle(({ store }) => getBins(store));
