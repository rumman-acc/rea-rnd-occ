import { badRequest, handle, notFound } from "@/server/http";
import { buyRecommendation } from "@/server/modules/purchasing/engine";
import { HORIZONS, type Horizon } from "@/server/modules/purchasing/types";

// GET /api/buy-recommendation/{item}?horizon=auto|urgent|2w|1m|3m
export const GET = handle<{ item: string }>(({ store, params, url }) => {
  const horizon = url.searchParams.get("horizon") ?? "auto";
  if (!HORIZONS.includes(horizon as Horizon)) throw badRequest(`horizon must be one of ${HORIZONS.join(", ")}`);
  const rec = buyRecommendation(store, params.item, horizon as Horizon);
  if (!rec) throw notFound(`Unknown component "${params.item}"`);
  return rec;
});
