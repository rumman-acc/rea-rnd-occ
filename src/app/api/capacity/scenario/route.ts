import { handle } from "@/server/http";
import { runScenario } from "@/server/modules/production/capacity";

export const POST = handle(async (c) => runScenario(c.store, await c.json()));
