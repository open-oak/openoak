import assert from "node:assert/strict";
import test from "node:test";

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyOpenOakAccessToken } from "../lib/auth";

const issuer = "https://account.openoak.org";
const resource = "https://mcp.openoak.org";
const now = Math.floor(Date.now() / 1_000);
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = "test-key";
publicJwk.alg = "RS256";
const key = createLocalJWKSet({ keys: [publicJwk] });

function token(overrides: {
  issuer?: string;
  audience?: string;
  expiresAt?: number;
  issuedAt?: number;
  scope?: string;
  subject?: string;
  clientId?: string;
} = {}) {
  return new SignJWT({
    scope: overrides.scope ?? "openid offline_access openoak:read openoak:write",
    client_id: overrides.clientId ?? "client-1",
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "at+jwt" })
    .setIssuer(overrides.issuer ?? issuer)
    .setAudience(overrides.audience ?? resource)
    .setSubject(overrides.subject ?? "user-1")
    .setIssuedAt(overrides.issuedAt ?? now)
    .setExpirationTime(overrides.expiresAt ?? now + 600)
    .sign(privateKey);
}

const request = new Request(resource, { headers: { "x-request-id": "request-1" } });
const verifyOptions = { issuer, resource, key, revoked: async () => false };

test("accepts an audience-bound, unexpired token and exposes user/scopes", async () => {
  const auth = await verifyOpenOakAccessToken(request, await token(), verifyOptions);
  assert.equal(auth?.clientId, "client-1");
  assert.deepEqual(auth?.scopes, ["openid", "offline_access", "openoak:read", "openoak:write"]);
  assert.equal(auth?.extra?.userId, "user-1");
  assert.equal(auth?.extra?.requestId, "request-1");
  assert.equal(auth?.resource?.href, `${resource}/`);
});

test("accepts the equivalent trailing-slash root resource used by Codex", async () => {
  const auth = await verifyOpenOakAccessToken(request, await token({ audience: `${resource}/` }), verifyOptions);
  assert.equal(auth?.clientId, "client-1");
  assert.equal(auth?.resource?.href, `${resource}/`);
});

test("rejects invalid issuer, audience, expiry, missing identity, and revocation", async () => {
  assert.equal(await verifyOpenOakAccessToken(request, await token({ issuer: "https://evil.example" }), verifyOptions), undefined);
  assert.equal(await verifyOpenOakAccessToken(request, await token({ audience: "https://other.openoak.org" }), verifyOptions), undefined);
  assert.equal(await verifyOpenOakAccessToken(request, await token({ expiresAt: now - 1 }), verifyOptions), undefined);
  assert.equal(await verifyOpenOakAccessToken(request, await token({ subject: "" }), verifyOptions), undefined);
  assert.equal(await verifyOpenOakAccessToken(request, await token(), { ...verifyOptions, revoked: async () => true }), undefined);
});

test("does not trust an unbounded request id header", async () => {
  const unsafeRequest = new Request(resource, { headers: { "x-request-id": "private note body ".repeat(20) } });
  const auth = await verifyOpenOakAccessToken(unsafeRequest, await token(), verifyOptions);
  assert.match(String(auth?.extra?.requestId), /^[0-9a-f-]{36}$/);
});
