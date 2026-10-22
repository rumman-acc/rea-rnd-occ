import { handle } from "@/server/http";
import { incomeStatement, periodOf } from "@/server/modules/finance/reports";

export const GET = handle(({ store, url }) => {
  const p = periodOf(url.searchParams.get("year"), url.searchParams.get("month"));
  return incomeStatement(store, p.year, p.month);
});
