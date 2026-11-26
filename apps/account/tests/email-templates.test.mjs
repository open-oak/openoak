import assert from "node:assert/strict";
import test from "node:test";

import {
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
} from "../lib/email-templates.ts";

const actionUrl = "https://account.openoak.org/api/auth/verify-email?token=abc&callbackURL=%2Fapps";

test("verification email includes the OpenOak mark, accessible action, and plain-text fallback", () => {
  const email = verificationEmail(actionUrl);

  assert.equal(email.subject, "Verify your OpenOak email");
  assert.match(email.html, /🌳 OpenOak/);
  assert.doesNotMatch(email.html, />O</);
  assert.match(email.html, /background-color:#234c3b/);
  assert.match(email.html, /Verify email/);
  assert.match(email.html, /expires in one hour/);
  assert.match(email.html, /callbackURL=%2Fapps/);
  assert.match(email.html, /abc&amp;callbackURL/);
  assert.match(email.text, /Verify email: https:\/\/account\.openoak\.org/);
  assert.match(email.text, /abc&callbackURL/);
});

test("password reset email clearly states the expiry and unchanged-password safety message", () => {
  const email = passwordResetEmail("https://account.openoak.org/reset-password/token");

  assert.match(email.html, /Reset your password/);
  assert.match(email.text, /expires in one hour/);
  assert.match(email.text, /Your password has not changed/);
});

test("password changed email gives an immediate recovery action", () => {
  const email = passwordChangedEmail("https://account.openoak.org/forgot-password");

  assert.equal(email.subject, "Your OpenOak password was changed");
  assert.match(email.text, /If you didn’t, reset your password now/);
  assert.match(email.html, /https:\/\/account\.openoak\.org\/forgot-password/);
});

test("dynamic values are escaped in HTML without changing the plain-text URL", () => {
  const unsafeUrl = 'https://example.com/?next=<script>&label="hello"';
  const email = verificationEmail(unsafeUrl);

  assert.doesNotMatch(email.html, /<script>/);
  assert.match(email.html, /&lt;script&gt;/);
  assert.match(email.html, /&quot;hello&quot;/);
  assert.match(email.text, /next=<script>&label="hello"/);
});
