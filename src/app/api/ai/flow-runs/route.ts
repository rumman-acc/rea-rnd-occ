import { handle } from "@/server/http";
import { listFlowRuns } from "@/server/modules/ai/core";
import { publicRun } from "@/server/modules/ai/flows";

export const GET = handle(({ store, url }) => {
  const id = url.searchParams.get("flow_id");
  return listFlowRuns(store).filter((r) => !id || r.flow_id === id).map(publicRun);
});
