import { handle } from "@/server/http";
import { capacityPlan, parseGranularity } from "@/server/modules/production/capacity";

export const GET = handle(({ store, url }) => capacityPlan(store, { granularity: parseGranularity(url.searchParams.get("granularity")) }));
