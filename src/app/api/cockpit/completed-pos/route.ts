import { handle } from "@/server/http";
import { completedPos } from "@/server/modules/warehouse/service";

export const GET = handle(({ store }) => completedPos(store));
