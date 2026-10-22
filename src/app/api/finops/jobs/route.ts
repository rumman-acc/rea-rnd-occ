import { handle } from "@/server/http";
import { listJobs, saveJob } from "@/server/modules/finance/finops";

export const GET = handle(({ store }) => ({ jobs: listJobs(store) }));
// PUT body { operator, job } creates or updates a job.
export const PUT = handle(async (c) => saveJob(c.store, await c.json(), c.actor));
