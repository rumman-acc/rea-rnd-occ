import { handle, notFound } from "@/server/http";
import { supplyDetail } from "@/server/modules/supply/netting";

// GET /api/supply-detail/{fg}
export const GET = handle<{ fg: string }>(({ store, params }) => {
  const d = supplyDetail(store, params.fg);
  if (!d) throw notFound(`Unknown finished good "${params.fg}"`);
  return d;
});
