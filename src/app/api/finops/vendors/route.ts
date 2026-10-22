import { handle } from "@/server/http";
import { listVendors } from "@/server/modules/finance/finops";

export const GET = handle(({ store }) => listVendors(store));
