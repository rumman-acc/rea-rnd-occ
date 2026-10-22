import { handle } from "@/server/http";
import { listAccounts } from "@/server/modules/finance/finops";

export const GET = handle(({ store, url }) => listAccounts(store, url.searchParams.get("all") === "true"));
