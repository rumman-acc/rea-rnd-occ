import { NextResponse, type NextRequest } from "next/server";
import { cookieFromHeader, verifySessionValue } from "@/server/auth";

// Gate for the whole app (SPEC-FULL decision D8, stub authentication).
// Public: the three auth pages, auth endpoints, the deployment health check,
// and framework assets.
const PUBLIC_PAGES = ["/login", "/forgot-password", "/reset-password"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PAGES.includes(pathname) || pathname.startsWith("/api/auth/") || pathname === "/api/health") {
    return NextResponse.next();
  }

  const user = verifySessionValue(cookieFromHeader(request.headers.get("cookie")));
  if (user) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
