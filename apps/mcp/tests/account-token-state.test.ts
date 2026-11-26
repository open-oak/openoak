import assert from "node:assert/strict";
import test from "node:test";
import { accountTokenIsRevoked } from "../lib/account-token-state";

test("a deleted account cannot use a signed token after revocation rows cascade", async () => {
  const database = { query: async () => ({ rows: [] }) };
  assert.equal(await accountTokenIsRevoked(database, "auth", "deleted", "client", 100), true);
});

test("existing accounts keep new tokens and reject tokens at or before disconnection", async () => {
  const active = { query: async () => ({ rows: [{ revokedAt: null }] }) };
  assert.equal(await accountTokenIsRevoked(active, "custom_auth", "user", "client", 100), false);
  const disconnected = { query: async () => ({ rows: [{ revokedAt: new Date(100_000) }] }) };
  assert.equal(await accountTokenIsRevoked(disconnected, "auth", "user", "client", 99), true);
  assert.equal(await accountTokenIsRevoked(disconnected, "auth", "user", "client", 100), true);
  assert.equal(await accountTokenIsRevoked(disconnected, "auth", "user", "client", 101), false);
});

test("schema names cannot change the token-state query", async () => {
  const database = { query: async () => { throw new Error("Must not query"); } };
  await assert.rejects(accountTokenIsRevoked(database, 'auth"; SELECT 1', "user", "client", 100), /Invalid ACCOUNT_DATABASE_SCHEMA/);
});
