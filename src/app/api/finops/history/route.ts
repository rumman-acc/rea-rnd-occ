import { handle } from "@/server/http";
import { history } from "@/server/modules/finance/finops";

export const GET = handle(({ store, url }) => history(store, url.searchParams.get("kind")));
