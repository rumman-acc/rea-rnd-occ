import { handle } from "@/server/http";
import { purchaseHistory } from "@/server/modules/purchasing/orders";

export const GET = handle(({ store }) => purchaseHistory(store));
