import { createMcpRequestHandler } from "@/lib/mcp-request-handler";
import { applyMcpCors, forbiddenMcpRequest, validateMcpRequestTarget } from "@/lib/http-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handler = createMcpRequestHandler();

export { handler as DELETE, handler as GET, handler as POST };

export function OPTIONS(request: Request) {
  const validation = validateMcpRequestTarget(request);
  if (!validation.ok) return forbiddenMcpRequest(validation.reason);
  const headers = new Headers({
    "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "Mcp-Session-Id, WWW-Authenticate",
    "Access-Control-Max-Age": "86400",
  });
  applyMcpCors(headers, validation.origin);
  return new Response(null, {
    status: 204,
    headers,
  });
}
