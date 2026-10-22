import { handle } from "@/server/http";
import { projection } from "@/server/modules/purchasing/orders";

// GET /api/plan/projection/{item}?with_recommendations=true|false
export const GET = handle<{ item: string }>(({ store, params, url }) =>
  projection(store, params.item, url.searchParams.get("with_recommendations") === "true"),
);
