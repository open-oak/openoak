import assert from "node:assert/strict";
import test from "node:test";

import { readClaudeCodeLoopbackRedirect } from "../lib/claude-code-redirect.ts";

const authorizeUrl = new URL("https://account.openoak.org/api/auth/oauth2/authorize");
authorizeUrl.searchParams.set("client_id", "https://claude.ai/oauth/claude-code-client-metadata");
authorizeUrl.searchParams.set("redirect_uri", "http://localhost:3118/callback");

test("accepts Claude Code's random unprivileged localhost callback", () => {
  assert.equal(
    readClaudeCodeLoopbackRedirect(new Request(authorizeUrl)),
    "http://localhost:3118/callback",
  );
});

test("rejects callbacks that are not the narrow Claude Code loopback shape", () => {
  for (const redirectUri of [
    "https://localhost:3118/callback",
    "http://127.0.0.1:3118/callback",
    "http://localhost:80/callback",
    "http://localhost:3118/other",
    "http://localhost:3118/callback?next=https://example.com",
    "https://example.com/callback",
  ]) {
    const candidate = new URL(authorizeUrl);
    candidate.searchParams.set("redirect_uri", redirectUri);
    assert.equal(readClaudeCodeLoopbackRedirect(new Request(candidate)), null);
  }
});

test("rejects the same callback for any other OAuth client", () => {
  const candidate = new URL(authorizeUrl);
  candidate.searchParams.set("client_id", "https://example.com/client-metadata.json");
  assert.equal(readClaudeCodeLoopbackRedirect(new Request(candidate)), null);
});
