import { suiteTrustedOrigins, suiteUrls } from "../../../shared/suite-config";
import { NextRequest, NextResponse } from "next/server";

export function secureRequest(request: NextRequest) {
  const origins = suiteTrustedOrigins();
  const accountOrigin = new URL(suiteUrls().account).origin;
  const nonce = btoa(crypto.randomUUID());
  const development = process.env.NODE_ENV !== "production";
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    `style-src-elem 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${origins.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${accountOrigin}`,
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);
  requestHeaders.set("x-nonce", nonce);
  const reportOnly = process.env.VERCEL_ENV === "preview" || process.env.CSP_REPORT_ONLY === "true";
  const responseHeader = reportOnly
    ? "Content-Security-Policy-Report-Only"
    : "Content-Security-Policy";

  function protect(response: NextResponse) {
    response.headers.set(responseHeader, policy);
    return response;
  }

  return {
    next: () => protect(NextResponse.next({ request: { headers: requestHeaders } })),
    redirect: (destination: URL) => protect(NextResponse.redirect(destination)),
  };
}
