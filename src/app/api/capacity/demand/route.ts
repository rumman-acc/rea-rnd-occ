import { handle } from "@/server/http";
import { capacityDemand, parseGranularity } from "@/server/modules/production/capacity";

export const GET = handle(({ store, url }) => capacityDemand(store, parseGranularity(url.searchParams.get("granularity"))));
