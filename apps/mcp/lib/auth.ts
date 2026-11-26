import type { AuthInfo } from "@modelcontextprotocol/server";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { Pool } from "pg";
import { postgresConnectionConfig } from "./postgres-connection";
import { accountTokenIsRevoked } from "./account-token-state";

const issuer = (process.env.ACCOUNT_ISSUER_URL || "https://account.openoak.org").replace(/\/$/, "");
const resource = (process.env.MCP_RESOURCE_URL || "https://mcp.openoak.org").replace(/\/$/, "");
const jwksUrl = process.env.ACCOUNT_JWKS_URL || `${issuer}/api/auth/jwks`;
const jwks = createRemoteJWKSet(new URL(jwksUrl));

const globalForAccountDb = globalThis as unknown as { openoakMcpAccountPool?: Pool };

function accountPool() {
  if (globalForAccountDb.openoakMcpAccountPool) return globalForAccountDb.openoakMcpAccountPool;
  const connectionString = process.env.ACCOUNT_DATABASE_URL;
  if (!connectionString) throw new Error("ACCOUNT_DATABASE_URL is not configured.");
  const pool = new Pool({
    ...postgresConnectionConfig(connectionString),
    max: 3,
  });
  globalForAccountDb.openoakMcpAccountPool = pool;
  return pool;
}

function accountSchema() {
  const schema = process.env.ACCOUNT_DATABASE_SCHEMA || "public";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error("Invalid ACCOUNT_DATABASE_SCHEMA.");
  return schema;
}

export async function checkAccountDatabase() {
  await accountPool().query("SELECT 1");
}

async function isRevoked(userId: string, clientId: string, issuedAt: number) {
  return accountTokenIsRevoked(accountPool(), accountSchema(), userId, clientId, issuedAt);
}

type AccessTokenVerificationOptions = {
  issuer?: string;
  resource?: string;
  key?: JWTVerifyGetKey;
  revoked?: (userId: string, clientId: string, issuedAt: number) => Promise<boolean>;
};

export async function verifyOpenOakAccessToken(
  request: Request,
  bearerToken?: string,
  options: AccessTokenVerificationOptions = {},
): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  try {
    const expectedIssuer = options.issuer ?? issuer;
    const expectedResource = options.resource ?? resource;
    const expectedAudiences = [expectedResource.replace(/\/$/, ""), `${expectedResource.replace(/\/$/, "")}/`];
    const { payload } = await jwtVerify(bearerToken, options.key ?? jwks, {
      issuer: expectedIssuer,
      audience: expectedAudiences,
    });
    const userId = typeof payload.sub === "string" ? payload.sub : "";
    const clientId = typeof payload.client_id === "string"
      ? payload.client_id
      : typeof payload.azp === "string"
        ? payload.azp
        : "";
    if (!userId || !clientId || typeof payload.exp !== "number" || typeof payload.iat !== "number") return undefined;
    if (await (options.revoked ?? isRevoked)(userId, clientId, payload.iat)) return undefined;
    const scopes = typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [];
    const proposedRequestId = request.headers.get("x-request-id") || "";
    const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(proposedRequestId) ? proposedRequestId : crypto.randomUUID();
    return {
      token: bearerToken,
      clientId,
      scopes,
      expiresAt: payload.exp,
      resource: new URL(expectedAudiences[0]),
      extra: {
        userId,
        requestId,
      },
    };
  } catch {
    return undefined;
  }
}

export function verifyOpenOakToken(request: Request, bearerToken?: string) {
  return verifyOpenOakAccessToken(request, bearerToken);
}

export const mcpAuthConfig = { issuer, resource, jwksUrl };
