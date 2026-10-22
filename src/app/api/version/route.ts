import { handle } from "@/server/http";
import { APP_VERSION } from "@/server/version";

export const GET = handle(() => ({ version: APP_VERSION }));
