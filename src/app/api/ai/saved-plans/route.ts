import { handle } from "@/server/http";
import { listPlans } from "@/server/modules/ai/inbox";

export const GET = handle(({ store }) => listPlans(store));
