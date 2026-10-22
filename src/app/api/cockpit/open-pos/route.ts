import { handle } from "@/server/http";
import { openPos } from "@/server/modules/purchasing/orders";

export const GET = handle(({ store }) => openPos(store));
