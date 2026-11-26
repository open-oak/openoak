import { generateProtectedResourceMetadata, metadataCorsOptionsRequestHandler } from "mcp-handler";
import { mcpAuthConfig } from "@/lib/auth";

export const runtime = "nodejs";

export function GET() {
  const metadata = generateProtectedResourceMetadata({
    authServerUrls: [mcpAuthConfig.issuer],
    resourceUrl: mcpAuthConfig.resource,
    additionalMetadata: {
      resource_name: "OpenOak MCP",
      resource_documentation: "https://openoak.org/mcp",
      scopes_supported: ["openoak:read", "openoak:write"],
    },
  });
  return Response.json(metadata, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}

export const OPTIONS = metadataCorsOptionsRequestHandler();
