import assert from "node:assert/strict";
import test from "node:test";

import notesRedirect from "../websites/openoak/api/notes-redirect.js";
import legalRedirect from "../websites/opentodo/api/legal-redirect.js";
import mcpRedirect from "../websites/openoak/api/mcp-redirect.js";

function invoke(handler, url) {
  const headers = new Map();
  let statusCode;
  let ended = false;
  const response = {
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    status(value) {
      statusCode = value;
      return this;
    },
    end() {
      ended = true;
    },
  };

  handler({ url }, response);
  return { ended, headers, statusCode };
}

test("MCP setup links open the setup tab of AI connections", () => {
  const result = invoke(mcpRedirect, "/api/mcp-redirect");
  assert.equal(result.statusCode, 308);
  assert.equal(result.headers.get("location"), "https://account.openoak.org/connected-ai?tab=setup");
  assert.equal(result.headers.get("cache-control"), "public, max-age=3600");
});

test("legacy Notes paths redirect to Outline and preserve the query", () => {
  const result = invoke(
    notesRedirect,
    "/api/notes-redirect?redirectPath=project%2Fcard&source=legacy",
  );

  assert.equal(result.statusCode, 308);
  assert.equal(result.ended, true);
  assert.equal(result.headers.get("location"), "https://openoak.org/outline/project/card?source=legacy");
  assert.equal(result.headers.get("cache-control"), "public, max-age=3600");
});

test("legacy OpenTodo legal paths redirect to the canonical policy", () => {
  const result = invoke(legalRedirect, "/api/legal-redirect?source=legacy");

  assert.equal(result.statusCode, 308);
  assert.equal(result.ended, true);
  assert.equal(result.headers.get("location"), "https://openoak.org/legal/?source=legacy");
  assert.equal(result.headers.get("cache-control"), "public, max-age=3600");
});
