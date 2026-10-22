import { authenticate, createSessionValue, sessionCookieHeader } from "@/server/auth";
import { appendAudit } from "@/server/audit";
import { badRequest, handle, unauthorized } from "@/server/http";

export const POST = handle(async (c) => {
  const { email, password } = await c.json<{ email?: string; password?: string }>();
  if (!email || !password) throw badRequest("Email and password are required");
  const user = authenticate(c.store, email, password);
  if (!user) throw unauthorized("Invalid email or password");
  appendAudit(c.store, { source: "auth", actor: user.name, action: "login", detail: user.email });
  return new Response(JSON.stringify({ user }), {
    headers: { "content-type": "application/json", "set-cookie": sessionCookieHeader(createSessionValue(user)) },
  });
});
