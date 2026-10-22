import { handle } from "@/server/http";
import { syncStatus } from "@/server/modules/finance/gl";

export const GET = handle(({ store }) => syncStatus(store));
