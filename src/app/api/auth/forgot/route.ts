import { createResetToken } from "@/server/auth";
import { badRequest, handle } from "@/server/http";

// There is no email delivery in this build. To keep the flow usable the reset token is
// returned in the response (demo only). Unknown emails get the same shape without a token,
// so the response does not confirm which accounts exist except through `token` presence.
export const POST = handle(async (c) => {
  const { email } = await c.json<{ email?: string }>();
  if (!email) throw badRequest("Email is required");
  const token = createResetToken(c.store, email);
  return { ok: true, token, note: "Demo only: no email is sent; use this token on the reset page." };
});
