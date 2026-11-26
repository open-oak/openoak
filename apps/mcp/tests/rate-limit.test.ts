import assert from "node:assert/strict";
import test from "node:test";
import type { AuthInfo } from "@modelcontextprotocol/server";

import { checkMcpRateLimit, resetMcpRateLimitsForTests } from "../lib/rate-limit";

function request() {
  const value = new Request("https://mcp.openoak.org", { method: "POST" });
  value.auth = {
    token: "not-logged",
    clientId: "client-1",
    scopes: ["openoak:read", "openoak:write"],
    extra: { userId: "user-1", requestId: "request-1" },
  } satisfies AuthInfo;
  return value;
}

test("observes generous limits before enforcement is enabled", () => {
  resetMcpRateLimitsForTests();
  process.env.MCP_RATE_LIMIT_MODE = "observe";
  process.env.MCP_READ_RATE_LIMIT_PER_MINUTE = "1";
  assert.equal(checkMcpRateLimit(request(), false, 1_000).allowed, true);
  const observed = checkMcpRateLimit(request(), false, 1_001);
  assert.equal(observed.exceeded, true);
  assert.equal(observed.allowed, true);
});

test("enforces separate read and write budgets when enabled", () => {
  resetMcpRateLimitsForTests();
  process.env.MCP_RATE_LIMIT_MODE = "enforce";
  process.env.MCP_READ_RATE_LIMIT_PER_MINUTE = "2";
  process.env.MCP_WRITE_RATE_LIMIT_PER_MINUTE = "1";
  assert.equal(checkMcpRateLimit(request(), false, 2_000).allowed, true);
  assert.equal(checkMcpRateLimit(request(), false, 2_001).allowed, true);
  assert.equal(checkMcpRateLimit(request(), false, 2_002).allowed, false);
  assert.equal(checkMcpRateLimit(request(), true, 2_003).allowed, true);
  const rejected = checkMcpRateLimit(request(), true, 2_004);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.retryAfterSeconds, 60);
});

test.afterEach(() => {
  delete process.env.MCP_RATE_LIMIT_MODE;
  delete process.env.MCP_READ_RATE_LIMIT_PER_MINUTE;
  delete process.env.MCP_WRITE_RATE_LIMIT_PER_MINUTE;
  resetMcpRateLimitsForTests();
});
