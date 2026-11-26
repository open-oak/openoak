import { NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { authCookiePrefix, loginUrl, usesSharedAuth } from "@/lib/auth-mode";
import { secureRequest } from "@/lib/secure-request";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const security = secureRequest(request);

  if (pathname === "/health" || pathname === "/login" || pathname.startsWith("/api/auth") || pathname.includes(".") || pathname.startsWith("/_next")) {
    return security.next();
  }

  const sessionCookie = getSessionCookie(request, { cookiePrefix: authCookiePrefix });
  if (!sessionCookie) {
    const destination = loginUrl(request.url);
    destination.searchParams.set("redirect", usesSharedAuth ? request.url : `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return security.redirect(destination);
  }

  return security.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
