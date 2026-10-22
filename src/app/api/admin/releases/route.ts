import { handle } from "@/server/http";
import { listUpgrades, releaseList } from "@/server/modules/admin/releases";
import { APP_VERSION } from "@/server/version";

export const GET = handle(({ store }) => ({ current: APP_VERSION, releases: releaseList(), upgrades: listUpgrades(store), simulated: true }));
