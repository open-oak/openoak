import assert from "node:assert/strict";
import test from "node:test";

import {
  getOAuthLoginDestination,
  hasOAuthLoginContinuation,
} from "../lib/oauth-login.ts";

const oauthLoginQuery = new URLSearchParams({
  client_id: "https://claude.ai/oauth/claude-code-client-metadata",
  exp: "1788343200",
  ba_iat: "1788342600000",
  ba_param: "client_id",
  sig: "signed-query",
});

test("recognizes a signed OAuth login continuation", () => {
  assert.equal(hasOAuthLoginContinuation(oauthLoginQuery), true);
  assert.equal(hasOAuthLoginContinuation(new URLSearchParams({ redirect: "/apps" })), false);
});

test("recognizes a signed OAuth continuation from Next.js search params", () => {
  assert.equal(
    hasOAuthLoginContinuation({
      client_id: "client",
      exp: "1788343200",
      ba_iat: "1788342600000",
      ba_param: ["client_id", "redirect_uri"],
      sig: "signed-query",
    }),
    true,
  );
});

test("uses the provider response instead of the normal account completion route", () => {
  assert.equal(
    getOAuthLoginDestination(oauthLoginQuery, {
      redirect: true,
      url: "https://account.openoak.org/oauth/consent?client_id=claude",
    }),
    "https://account.openoak.org/oauth/consent?client_id=claude",
  );
});

test("never falls through to the account destination for a broken OAuth continuation", () => {
  assert.equal(getOAuthLoginDestination(oauthLoginQuery, { redirect: false, url: null }), null);
  assert.equal(
    getOAuthLoginDestination(new URLSearchParams(), {
      redirect: true,
      url: "/auth/complete",
    }),
    undefined,
  );
});
