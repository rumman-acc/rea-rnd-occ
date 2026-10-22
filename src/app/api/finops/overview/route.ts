import { handle } from "@/server/http";
import { overview } from "@/server/modules/finance/finops";

export const GET = handle(({ store }) => overview(store));
