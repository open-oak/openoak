import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth-server";
import { sanitizeRedirect } from "@/lib/redirects";

export async function GET(request: NextRequest) {
  const redirectTo = sanitizeRedirect(request.nextUrl.searchParams.get("redirect"));
  const verificationError = request.nextUrl.searchParams.get("error");

  if (verificationError) {
    const failureUrl = new URL("/verify-email", request.url);
    failureUrl.searchParams.set("error", verificationError);
    if (redirectTo !== "/apps") failureUrl.searchParams.set("redirect", redirectTo);
    return NextResponse.redirect(failureUrl);
  }

  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("verified", "success");
    if (redirectTo !== "/apps") loginUrl.searchParams.set("redirect", redirectTo);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(new URL(redirectTo, request.url));
}
