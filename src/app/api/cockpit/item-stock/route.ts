import { handle } from "@/server/http";
import { itemStock } from "@/server/modules/warehouse/service";

export const GET = handle(({ store, url }) => itemStock(store, url.searchParams.get("item_no") ?? ""));
