import { handle } from "@/server/http";
import { poReceivedLines } from "@/server/modules/warehouse/service";

export const GET = handle(({ store, url }) => poReceivedLines(store, url.searchParams.get("po_id") ?? ""));
