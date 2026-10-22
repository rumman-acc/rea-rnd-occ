import { handle } from "@/server/http";
import { listBankAccounts } from "@/server/modules/finance/finops";

export const GET = handle(({ store }) => listBankAccounts(store));
