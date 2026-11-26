import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const accountRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(join(accountRoot, "package.json"), "utf8"));
const authSource = readFileSync(join(accountRoot, "lib/auth-server.ts"), "utf8");
const authorizationMetadataSource = readFileSync(
  join(accountRoot, "app/.well-known/oauth-authorization-server/route.ts"),
  "utf8",
);
const openIdMetadataSource = readFileSync(
  join(accountRoot, "app/.well-known/openid-configuration/route.ts"),
  "utf8",
);
const providerDist = dirname(fileURLToPath(import.meta.resolve("@better-auth/oauth-provider")));
const authorizeBundle = readFileSync(
  join(providerDist, readdirSync(providerDist).find((name) => name.startsWith("authorize-") && name.endsWith(".mjs"))),
  "utf8",
);

test("OAuth and CIMD dependencies use the patched stable 1.7.19 release", () => {
  for (const name of ["better-auth", "@better-auth/core", "@better-auth/cimd", "@better-auth/oauth-provider"]) {
    assert.equal(packageJson.dependencies[name], "1.7.19", name);
    assert.doesNotMatch(packageJson.dependencies[name], /(?:alpha|beta|rc)/i);
  }
});

test("default MCP registration requests only identity, refresh, read, and write scopes", () => {
  assert.match(authSource, /const oauthScopes = \["openid", "offline_access", "openoak:read", "openoak:write"\]/);
  assert.doesNotMatch(authSource, /oauthScopes[^;]*(?:"profile"|"email")/);
  assert.match(authSource, /allowDynamicClientRegistration: true/);
  assert.match(authSource, /metadataProfile: "mcp-2026-07-28"/);
});

test("the stable provider supports and returns the exact RFC 9207 issuer", () => {
  assert.match(authorizeBundle, /authorization_response_iss_parameter_supported: true/);
  assert.match(authorizeBundle, /redirectUriWithCode\.searchParams\.set\("iss", getIssuer\(ctx, opts\)\)/);
});

test("public metadata keeps the temporary Codex issuer compatibility workaround", () => {
  for (const source of [authorizationMetadataSource, openIdMetadataSource]) {
    assert.match(source, /delete document\.authorization_response_iss_parameter_supported/);
  }
});
