import { handle } from "@/server/http";
import { workCenters } from "@/server/modules/production/data";

export const GET = handle(({ store }) => workCenters(store));
