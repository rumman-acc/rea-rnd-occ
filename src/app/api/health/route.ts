import { handle } from "@/server/http";
import { APP_VERSION } from "@/server/version";

export const dynamic = "force-dynamic";

export const GET = handle(({ store }) => ({
  status: "ok",
  version: APP_VERSION,
  store: "available",
  documents: store.keys().length,
}));
