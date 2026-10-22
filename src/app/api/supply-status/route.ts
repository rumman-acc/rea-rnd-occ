import { handle } from "@/server/http";
import { supplyStatuses } from "@/server/modules/supply/netting";

export const GET = handle(({ store }) => supplyStatuses(store));
