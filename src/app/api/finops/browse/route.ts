import { handle } from "@/server/http";
import { browse } from "@/server/modules/finance/finops";

export const GET = handle(({ store, url }) => browse(store, url.searchParams.get("path")));
