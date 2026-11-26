import assert from "node:assert/strict";
import { sanitizeRedirect } from "../lib/redirects.ts";

for (const destination of ["/connected-ai", "/connected-ai?tab=services", "/connected-ai?tab=setup"]) {
  assert.equal(sanitizeRedirect(destination), destination);
}
for (const destination of ["//evil.example/connected-ai", "/\\evil.example/connected-ai", "/connected-ai?redirect=https://evil.example", "https://evil.example/connected-ai", "javascript:alert(1)"]) {
  assert.equal(sanitizeRedirect(destination), "/apps");
}
assert.equal(sanitizeRedirect("https://todo.openoak.org/"), "https://todo.openoak.org/");
