import { handle } from "@/server/http";
import { logRefresh, refreshAccounts } from "@/server/modules/finance/finops";

// Simulated: re-derives which accounts are active from ledger postings (no external chart of accounts).
export const POST = handle(({ store, actor }) => {
  const r = refreshAccounts(store, actor);
  logRefresh(store, actor, `refreshed: activated ${r.activated}, deactivated ${r.deactivated} (simulated)`);
  return r;
});
