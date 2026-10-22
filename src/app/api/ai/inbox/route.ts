import { handle } from "@/server/http";
import { listItems } from "@/server/modules/ai/inbox";

export const GET = handle(({ store, url }) => listItems(store, url.searchParams.get("pending_only") === "true"));
