import { handle } from "@/server/http";
import { listHistory } from "@/server/modules/warehouse/service";

export const GET = handle(({ store, url }) => listHistory(store, url.searchParams.get("kind") ?? ""));
