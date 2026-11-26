import {
  type AuthInfo,
  bearerAuthChallengeResponse,
  OAuthError,
  OAuthErrorCode,
} from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { mcpAuthConfig, verifyOpenOakToken } from "@/lib/auth";
import { isWriteToolName, registerOpenOakTools } from "@/lib/register-tools";
import {
  applyMcpCors,
  forbiddenMcpRequest,
  validateMcpRequestTarget,
} from "@/lib/http-security";
import { checkMcpRateLimit } from "@/lib/rate-limit";

const transport = createMcpHandler(registerOpenOakTools, {
  serverInfo: { name: "openoak", version: "0.1.0" },
  instructions: [
    "OpenOak provides authenticated access to Outline notes, Kanban projects, and Todo tasks.",
    "Read the latest updatedAt or revision before mutating an existing record.",
    "Never retry a conflict by overwriting newer data; read again and reconcile first.",
    "Deletion tools are permanent and should be called only after the client has confirmed the destructive action.",
  ].join(" "),
  cacheHints: {
    "server/discover": { ttlMs: 300_000, cacheScope: "public" },
    "tools/list": { ttlMs: 300_000, cacheScope: "public" },
  },
  verboseLogs: false,
});

const resourceMetadataUrl = `${mcpAuthConfig.resource}/.well-known/oauth-protected-resource`;

async function requestedToolName(request: Request) {
  if (request.method !== "POST" || !(request.headers.get("content-type") || "").includes("application/json")) return null;
  try {
    const body = await request.clone().json() as { method?: unknown; params?: { name?: unknown } };
    const bodyMethod = typeof body.method === "string" ? body.method : null;
    const bodyName = typeof body.params?.name === "string" ? body.params.name : null;
    const headerMethod = request.headers.get("mcp-method");
    const headerName = request.headers.get("mcp-name");
    if (headerMethod && headerMethod !== bodyMethod) return null;
    if (headerName && headerName !== bodyName) return null;
    return bodyMethod === "tools/call" ? bodyName : null;
  } catch {
    return null;
  }
}

async function scopeAwareTransport(request: Request) {
  const toolName = await requestedToolName(request);
  if (toolName && isWriteToolName(toolName) && !request.auth?.scopes.includes("openoak:write")) {
    return bearerAuthChallengeResponse(
      new OAuthError(OAuthErrorCode.InsufficientScope, "This tool requires openoak:write."),
      { requiredScopes: ["openoak:write"], resourceMetadataUrl },
    );
  }
  if (request.method === "POST" && request.auth) {
    const rateLimit = checkMcpRateLimit(request, Boolean(toolName && isWriteToolName(toolName)));
    if (rateLimit.exceeded) {
      console.info(JSON.stringify({
        requestId: typeof request.auth.extra?.requestId === "string" ? request.auth.extra.requestId : crypto.randomUUID(),
        toolName: toolName || request.headers.get("mcp-method") || "unknown",
        durationMs: 0,
        outcome: rateLimit.allowed ? "rate_limit_observed" : "rate_limited",
        errorClass: "rate_limit",
      }));
    }
    if (!rateLimit.allowed) {
      return Response.json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32029, message: "Too many requests. Try again shortly." },
      }, {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "RateLimit-Limit": String(rateLimit.limit),
          "RateLimit-Remaining": String(rateLimit.remaining),
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      });
    }
  }
  return transport(request);
}

function addDefaultScopeChallenge(headers: Headers, status: number) {
  if (status !== 401) return;
  const challenge = headers.get("WWW-Authenticate");
  if (!challenge || /(?:^|,\s*)scope=/i.test(challenge)) return;
  headers.set("WWW-Authenticate", `${challenge}, scope="openoak:read openoak:write"`);
}

type TokenVerifier = (request: Request, bearerToken?: string) => AuthInfo | undefined | Promise<AuthInfo | undefined>;

export function createMcpRequestHandler(verifyToken: TokenVerifier = verifyOpenOakToken) {
  const authenticatedHandler = withMcpAuth(scopeAwareTransport, verifyToken, {
    required: true,
    resourceMetadataPath: "/.well-known/oauth-protected-resource",
    resourceUrl: mcpAuthConfig.resource,
  });

  return async function handleSecurely(request: Request) {
    const validation = validateMcpRequestTarget(request);
    if (!validation.ok) return forbiddenMcpRequest(validation.reason);
    const response = await authenticatedHandler(request);
    const headers = new Headers(response.headers);
    addDefaultScopeChallenge(headers, response.status);
    applyMcpCors(headers, validation.origin);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}
