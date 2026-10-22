import { resetPassword } from "@/server/auth";
import { appendAudit } from "@/server/audit";
import { badRequest, handle } from "@/server/http";

export const POST = handle(async (c) => {
  const { token, password } = await c.json<{ token?: string; password?: string }>();
  if (!token || !password) throw badRequest("Token and new password are required");
  if (password.length < 8) throw badRequest("Password must be at least 8 characters");
  if (!resetPassword(c.store, token, password)) throw badRequest("Invalid or expired reset token");
  appendAudit(c.store, { source: "auth", actor: "reset-token", action: "password-reset" });
  return { ok: true };
});
