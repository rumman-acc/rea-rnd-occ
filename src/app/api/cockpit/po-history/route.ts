import { handle } from "@/server/http";
import { poHistory } from "@/server/modules/purchasing/orders";

export const GET = handle(({ store }) => poHistory(store));
