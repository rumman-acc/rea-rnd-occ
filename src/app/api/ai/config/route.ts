import { handle } from "@/server/http";
import { configView } from "@/server/modules/ai/inbox";

export const GET = handle(({ store }) => configView(store));
