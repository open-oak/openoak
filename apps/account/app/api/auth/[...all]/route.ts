import { accountIssuer, auth } from "@/lib/auth-server";
import { prepareClaudeCodeLoopbackRedirect } from "@/lib/claude-code-oauth";
import { readClaudeCodeLoopbackRedirect } from "@/lib/claude-code-redirect";
import { ensureOAuthIssuerResponse } from "@/lib/oauth-issuer-response";
import { toNextJsHandler } from "better-auth/next-js";

const handlers = toNextJsHandler(auth);

export async function GET(request: Request) {
  const redirectUri = readClaudeCodeLoopbackRedirect(request);
  if (!redirectUri) {
    return ensureOAuthIssuerResponse(request, await handlers.GET(request), accountIssuer);
  }

  // Existing CIMD clients can be prepared before authorization. On the first
  // request, let CIMD validate and create the client, then prepare and retry.
  if (await prepareClaudeCodeLoopbackRedirect(redirectUri)) {
    return ensureOAuthIssuerResponse(request, await handlers.GET(request), accountIssuer);
  }
  const firstResponse = await handlers.GET(request);
  if (await prepareClaudeCodeLoopbackRedirect(redirectUri)) {
    return ensureOAuthIssuerResponse(request, await handlers.GET(request), accountIssuer);
  }
  return ensureOAuthIssuerResponse(request, firstResponse, accountIssuer);
}

export async function POST(request: Request) {
  return ensureOAuthIssuerResponse(request, await handlers.POST(request), accountIssuer);
}
