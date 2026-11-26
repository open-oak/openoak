import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "@/lib/auth-server";

export const runtime = "nodejs";
const metadata = oauthProviderAuthServerMetadata(auth);

export async function GET(request: Request) {
  const response = await metadata(request);
  const document = await response.json() as Record<string, unknown>;
  // Codex 0.143–0.146 drops `iss` from its loopback callback before validating it.
  // Keep sending `iss`, but temporarily avoid requiring affected clients to preserve it.
  delete document.authorization_response_iss_parameter_supported;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
  return Response.json(document, { status: response.status, headers });
}

export const HEAD = GET;

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Max-Age": "86400",
    },
  });
}
