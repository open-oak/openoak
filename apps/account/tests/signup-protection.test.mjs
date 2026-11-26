import assert from "node:assert/strict";
import { passwordPolicyError } from "../lib/password-policy.ts";
import {
  AUTH_RATE_LIMIT_RULES,
  BOT_PROTECTED_AUTH_PATHS,
  BOT_PROTECTED_ROUTES,
  EMAIL_COOLDOWN,
  botIdEnabled,
  emailCooldownKey,
  nextCooldownState,
  rateLimitStorage,
} from "../lib/signup-protection.ts";

// Password rule: same result for browser forms and the server hook.
assert.equal(passwordPolicyError("abc12345"), null);
assert.match(passwordPolicyError("abc1234"), /at least 8/);
assert.match(passwordPolicyError("12345678"), /letter/);
assert.match(passwordPolicyError("abcdefgh"), /number/);
assert.match(passwordPolicyError(`a1${"x".repeat(127)}`), /at most 128/);

// Better Auth strips "/api/auth" before it matches rules. A rule with that
// prefix never applies, which was the bug before this change.
for (const path of [...Object.keys(AUTH_RATE_LIMIT_RULES), ...BOT_PROTECTED_AUTH_PATHS]) {
  assert.ok(path.startsWith("/") && !path.startsWith("/api/auth"), path);
}
assert.ok(!Object.keys(AUTH_RATE_LIMIT_RULES).some((path) => path.includes("forget-password")));
for (const path of ["/sign-up/email", "/request-password-reset", "/send-verification-email"]) {
  assert.ok(path in AUTH_RATE_LIMIT_RULES, path);
  assert.ok(BOT_PROTECTED_AUTH_PATHS.includes(path), path);
}
assert.deepEqual(BOT_PROTECTED_ROUTES[0], { path: "/api/auth/sign-up/email", method: "POST" });
// Better Auth prunes rows older than its longest window from the shared table.
assert.ok(EMAIL_COOLDOWN.windowMs / 1000 <= Math.max(...Object.values(AUTH_RATE_LIMIT_RULES).map((rule) => rule.window)));

// Per-address cooldown: max sends per window, then a fresh window.
const start = 1_000_000n;
let row = null;
for (let send = 1; send <= EMAIL_COOLDOWN.max; send += 1) {
  const next = nextCooldownState(row, start + BigInt(send));
  assert.equal(next.allowed, true);
  assert.equal(next.count, send);
  row = { count: next.count, lastRequest: next.lastRequest };
}
assert.equal(nextCooldownState(row, start + 10n).allowed, false);
assert.equal(nextCooldownState(row, row.lastRequest + BigInt(EMAIL_COOLDOWN.windowMs) - 1n).allowed, false);
const fresh = nextCooldownState(row, row.lastRequest + BigInt(EMAIL_COOLDOWN.windowMs));
assert.deepEqual([fresh.allowed, fresh.count], [true, 1]);

// The key does not hold the address itself, and case or spaces do not dodge it.
const key = await emailCooldownKey("verification", " Someone@Example.org ");
assert.equal(key, await emailCooldownKey("verification", "someone@example.org"));
assert.notEqual(key, await emailCooldownKey("password-reset", "someone@example.org"));
assert.ok(!key.includes("example"));

// BotID runs on Vercel only, unless explicitly switched.
assert.equal(botIdEnabled({ VERCEL: "1" }), true);
assert.equal(botIdEnabled({}), false);
assert.equal(botIdEnabled({ VERCEL: "1", BOTID_ENABLED: "false" }), false);
assert.equal(botIdEnabled({ BOTID_ENABLED: "true" }), true);

// Database counters only where the build applies migrations (scripts/vercel-build.mjs).
assert.equal(rateLimitStorage({ VERCEL_ENV: "production" }), "database");
assert.equal(rateLimitStorage({}), "database");
assert.equal(rateLimitStorage({ VERCEL_ENV: "preview" }), "memory");
assert.equal(rateLimitStorage({ VERCEL_ENV: "preview", PREVIEW_DATABASE_ISOLATED: "true" }), "database");
