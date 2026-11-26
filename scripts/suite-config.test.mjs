import assert from "node:assert/strict";
import test from "node:test";
import { suiteUrls, suiteTrustedOrigins } from "../shared/suite-config.ts";
import { buildVersion } from "../shared/build-version.ts";

test("custom suites use the configured launcher, Account, MCP and browser origins", () => {
  const env = { OPENOAK_HOME_URL: "https://example.test", OPENOAK_ACCOUNT_URL: "https://account.example.test", OPENOAK_TODO_URL: "https://todo.example.test", OPENOAK_OUTLINE_URL: "https://notes.example.test", OPENOAK_KANBAN_URL: "https://boards.example.test", MCP_RESOURCE_URL: "https://tools.example.test/mcp", BETTER_AUTH_URL: "https://preview.example.test", AUTH_TRUSTED_ORIGINS: "https://preview.example.test, https://client.example.test" };
  assert.equal(suiteUrls(env).mcp, "https://tools.example.test/mcp");
  assert.equal(suiteUrls(env).todo, "https://todo.example.test");
  assert.deepEqual(suiteTrustedOrigins(env), ["https://example.test", "https://account.example.test", "https://todo.example.test", "https://notes.example.test", "https://boards.example.test", "https://tools.example.test", "https://preview.example.test", "https://client.example.test"]);
  assert(!suiteTrustedOrigins(env).some((origin) => origin.includes("openoak.org")));
});

test("suite configuration rejects header injection and credentials", () => {
  for (const value of ["javascript:alert(1)", "https://user:password@example.test", "https://example.test/?token=private", "https://example.test/#fragment", "https://example.test; evil.invalid\nscript-src *"]) assert.throws(() => suiteUrls({ OPENOAK_HOME_URL: value }));
});

test("version labels use the real package version and bounded revision", () => {
  assert.equal(buildVersion("0.1.0", "03bb5d32978ec8e04c2f712e1545b50c5ea0a224"), "0.1.0 (03bb5d3)");
  assert.equal(buildVersion("0.1.0", "private branch name"), "0.1.0");
  assert.equal(buildVersion(undefined, undefined), "Development");
});
