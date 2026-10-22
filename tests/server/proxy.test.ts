// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { createSessionValue, SESSION_COOKIE } from "@/server/auth";
import { proxy } from "@/proxy";

const user = { id: "u", email: "a@b.c", name: "A B", role: "Admin" };
const req = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, "http://localhost:3000"), { headers: cookie ? { cookie } : {} });

describe("proxy gate (stub authentication)", () => {
  it("redirects unauthenticated page requests to /login, remembering the target", () => {
    const res = proxy(req("/orders?x=1"));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/orders?x=1");
  });

  it("does not add ?next for the home page", () => {
    expect(new URL(proxy(req("/")).headers.get("location")!).search).toBe("");
  });

  it("answers unauthenticated API requests with 401 JSON", async () => {
    const res = proxy(req("/api/plan"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ detail: "Not authenticated" });
  });

  it("lets the auth pages and auth API through without a session", () => {
    for (const p of ["/login", "/forgot-password", "/reset-password", "/api/auth/login", "/api/auth/session"]) {
      expect(proxy(req(p)).headers.get("x-middleware-next"), p).toBe("1");
    }
  });

  it("lets a valid session through and rejects a forged one", () => {
    const ok = `${SESSION_COOKIE}=${createSessionValue(user)}`;
    expect(proxy(req("/api/plan", ok)).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(req("/orders", ok)).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(req("/api/plan", `${SESSION_COOKIE}=forged.value`)).status).toBe(401);
  });
});
