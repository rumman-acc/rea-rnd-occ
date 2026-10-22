import { sessionCookieHeader } from "@/server/auth";
import { handle } from "@/server/http";

export const POST = handle(
  () =>
    new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json", "set-cookie": sessionCookieHeader("", 0) },
    }),
);
