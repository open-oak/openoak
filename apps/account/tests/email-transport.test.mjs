import assert from "node:assert/strict";
import test from "node:test";

import {
  deliverPasswordChangedEmail,
  deliverPasswordResetEmail,
  deliverVerificationEmail,
  emailTransport,
} from "../lib/email.ts";

test("Resend needs a nonempty API key", () => {
  assert.equal(emailTransport({ NODE_ENV: "production" }), null);
  assert.equal(emailTransport({ RESEND_API_KEY: " " }), null);
  assert.deepEqual(emailTransport({ RESEND_API_KEY: " example " }), {
    kind: "resend",
    apiKey: "example",
  });
  assert.equal(emailTransport({ EMAIL_TRANSPORT: "unknown", RESEND_API_KEY: "example" }), null);
});

test("the log transport requires explicit opt-in and development mode", () => {
  assert.equal(emailTransport({ NODE_ENV: "development" }), null);
  assert.deepEqual(emailTransport({ NODE_ENV: "development", EMAIL_TRANSPORT: "log" }), { kind: "log" });
  assert.equal(emailTransport({ NODE_ENV: "production", EMAIL_TRANSPORT: "log", RESEND_API_KEY: "example" }), null);
});

test("only development logs verification and reset links", async (t) => {
  const originalEnv = process.env;
  t.after(() => { process.env = originalEnv; });
  process.env = { ...originalEnv, NODE_ENV: "development", EMAIL_TRANSPORT: "log" };
  const log = t.mock.method(console, "info", () => {});

  const verifyUrl = "http://localhost:3003/api/auth/verify-email?token=verify";
  const resetUrl = "http://localhost:3003/api/auth/reset-password/reset";
  const email = "local@example.test";
  await deliverVerificationEmail(email, verifyUrl);
  await deliverPasswordResetEmail(email, resetUrl);
  await deliverPasswordChangedEmail(email, "http://localhost:3003/forgot-password");

  process.env.NODE_ENV = "production";
  await assert.rejects(deliverVerificationEmail(email, verifyUrl), {
    message: "Email is not configured on this server.",
  });
  assert.deepEqual(log.mock.calls.map(({ arguments: args }) => args), [
    [`OpenOak verification link: ${verifyUrl}`],
    [`OpenOak password reset link: ${resetUrl}`],
  ]);
});
