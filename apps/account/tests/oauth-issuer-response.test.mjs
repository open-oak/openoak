import assert from "node:assert/strict";
import test from "node:test";

import { ensureOAuthIssuerResponse } from "../lib/oauth-issuer-response.ts";

const issuer = "https://account.openoak.org";
const callback = "http://127.0.0.1:43827/callback/session";

test("adds the exact issuer to a successful consent callback", async () => {
  const request = new Request(`${issuer}/api/auth/oauth2/consent`, { method: "POST" });
  const response = Response.json({
    redirect: true,
    url: `${callback}?code=authorization-code&state=request-state`,
  });

  const guarded = await ensureOAuthIssuerResponse(request, response, issuer);
  const body = await guarded.json();
  const redirect = new URL(body.url);

  assert.equal(redirect.searchParams.get("code"), "authorization-code");
  assert.equal(redirect.searchParams.get("state"), "request-state");
  assert.equal(redirect.searchParams.get("iss"), issuer);
});

test("adds the exact issuer to a successful authorize redirect", async () => {
  const request = new Request(`${issuer}/api/auth/oauth2/authorize`);
  const response = new Response(null, {
    status: 302,
    headers: { location: `${callback}?code=authorization-code&state=request-state` },
  });

  const guarded = await ensureOAuthIssuerResponse(request, response, issuer);
  const redirect = new URL(guarded.headers.get("location"));

  assert.equal(redirect.searchParams.get("code"), "authorization-code");
  assert.equal(redirect.searchParams.get("state"), "request-state");
  assert.equal(redirect.searchParams.get("iss"), issuer);
});

test("adds the exact issuer to an authorization error response", async () => {
  const request = new Request(`${issuer}/api/auth/oauth2/consent`, { method: "POST" });
  const response = Response.json({
    redirect: true,
    url: `${callback}?error=access_denied&state=request-state`,
  });

  const guarded = await ensureOAuthIssuerResponse(request, response, issuer);
  const body = await guarded.json();
  const redirect = new URL(body.url);

  assert.equal(redirect.searchParams.get("error"), "access_denied");
  assert.equal(redirect.searchParams.get("state"), "request-state");
  assert.equal(redirect.searchParams.get("iss"), issuer);
});

test("does not alter non-authorization responses", async () => {
  const request = new Request(`${issuer}/api/auth/oauth2/token`, { method: "POST" });
  const response = Response.json({ access_token: "token" });

  assert.equal(await ensureOAuthIssuerResponse(request, response, issuer), response);
});
