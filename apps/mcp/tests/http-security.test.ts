import assert from "node:assert/strict";
import test from "node:test";
import type { AuthInfo } from "@modelcontextprotocol/server";

import { OPTIONS } from "../app/route";
import { createMcpRequestHandler } from "../lib/mcp-request-handler";

const canonicalHeaders = { host: "mcp.openoak.org" };

function authInfo(scopes: string[]): AuthInfo {
  return {
    token: "test-token",
    clientId: "https://client.example/mcp.json",
    scopes,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
    resource: new URL("https://mcp.openoak.org"),
    extra: { userId: "user-1", requestId: "request-1" },
  };
}

test("rejects an unapproved host before authentication", async () => {
  const handler = createMcpRequestHandler(() => undefined);
  const response = await handler(new Request("https://evil.example", {
    headers: { host: "evil.example" },
  }));
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error_description, "Unapproved MCP host.");
});

test("rejects malformed and unapproved browser origins", async () => {
  const handler = createMcpRequestHandler(() => undefined);
  for (const origin of ["null", "https://evil.example", "https://chatgpt.com/path"]) {
    const response = await handler(new Request("https://mcp.openoak.org", {
      headers: { ...canonicalHeaders, origin },
    }));
    assert.equal(response.status, 403, origin);
  }
});

test("supports approved browser and originless native clients without wildcard CORS", async () => {
  const handler = createMcpRequestHandler(() => undefined);
  const browser = await handler(new Request("https://mcp.openoak.org", {
    headers: { ...canonicalHeaders, origin: "https://chatgpt.com" },
  }));
  assert.equal(browser.status, 401);
  assert.equal(browser.headers.get("access-control-allow-origin"), "https://chatgpt.com");
  assert.match(browser.headers.get("vary") || "", /Origin/);
  assert.match(browser.headers.get("www-authenticate") || "", /scope="openoak:read openoak:write"/);

  const native = await handler(new Request("https://mcp.openoak.org", { headers: canonicalHeaders }));
  assert.equal(native.status, 401);
  assert.equal(native.headers.get("access-control-allow-origin"), null);
  assert.match(native.headers.get("vary") || "", /Origin/);
});

test("preflight advertises modern routing headers and echoes only approved origins", async () => {
  const response = OPTIONS(new Request("https://mcp.openoak.org", {
    method: "OPTIONS",
    headers: { ...canonicalHeaders, origin: "https://claude.ai" },
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://claude.ai");
  assert.match(response.headers.get("access-control-allow-headers") || "", /Mcp-Method/);
  assert.match(response.headers.get("access-control-allow-headers") || "", /Mcp-Name/);
  assert.match(response.headers.get("access-control-allow-headers") || "", /MCP-Protocol-Version/);
});

test("read-only tokens receive an HTTP insufficient_scope challenge for write tools", async () => {
  const handler = createMcpRequestHandler(() => authInfo(["openoak:read"]));
  const response = await handler(new Request("https://mcp.openoak.org", {
    method: "POST",
    headers: {
      ...canonicalHeaders,
      authorization: "Bearer test-token",
      accept: "application/json",
      "content-type": "application/json",
      "mcp-method": "tools/call",
      "mcp-name": "todo_create_task",
      "mcp-protocol-version": "2026-07-28",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "todo_create_task", arguments: {} },
    }),
  }));
  assert.equal(response.status, 403);
  const challenge = response.headers.get("www-authenticate") || "";
  assert.match(challenge, /insufficient_scope/);
  assert.match(challenge, /scope="openoak:write"/);
  assert.match(challenge, /resource_metadata=/);
});
