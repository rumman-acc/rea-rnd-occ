import { handle } from "@/server/http";
import { queryGl } from "@/server/modules/finance/gl";

export const GET = handle(({ store, url }) => {
  const q = (k: string) => url.searchParams.get(k);
  return queryGl(store, { account_no: q("account_no"), source: q("source"), date_from: q("date_from"), date_to: q("date_to"), q: q("q"), limit: q("limit"), offset: q("offset") });
});
