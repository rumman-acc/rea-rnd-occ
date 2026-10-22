import { handle } from "@/server/http";
import { folderStatus } from "@/server/modules/finance/finops";

export const GET = handle(({ store, url }) => folderStatus(store, url.searchParams.get("path")));
