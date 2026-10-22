import { getSessionUser } from "@/server/auth";
import { handle } from "@/server/http";

export const GET = handle(({ req }) => ({ user: getSessionUser(req) }));
