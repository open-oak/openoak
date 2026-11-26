import assert from "node:assert/strict";
import test from "node:test";
import { requireAuthSecret } from "../shared/auth-secret.ts";

const developmentDefault = "development_secret_only_for_local_builds";
const productionModes = [{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }];

test("production refuses missing, short and placeholder credentials", () => {
  for (const env of productionModes) {
    for (const secret of [
      undefined,
      "",
      "   ",
      "a".repeat(31),
      ` ${"a".repeat(31)} `,
      "replace-with-a-long-random-secret",
      "replace-with-at-least-32-random-characters",
      " Replace-With-your-own-long-secret ",
      developmentDefault,
    ]) {
      assert.throws(() => requireAuthSecret({ ...env, BETTER_AUTH_SECRET: secret }, developmentDefault), /Refusing to start/);
    }
  }
});

test("production preserves the exact bytes of valid configured credentials", () => {
  const secret = ` ${"a".repeat(32)} `;
  for (const env of productionModes) {
    assert.equal(requireAuthSecret({ ...env, BETTER_AUTH_SECRET: secret }, developmentDefault), secret);
  }
});

test("development accepts configured credentials and falls back for blanks", () => {
  const env = { NODE_ENV: "development" };
  assert.equal(requireAuthSecret(env, developmentDefault), developmentDefault);
  assert.equal(requireAuthSecret({ ...env, BETTER_AUTH_SECRET: "   " }, developmentDefault), developmentDefault);
  assert.equal(requireAuthSecret({ ...env, BETTER_AUTH_SECRET: " short-secret " }, developmentDefault), " short-secret ");
});
