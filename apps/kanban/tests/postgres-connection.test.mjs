import assert from "node:assert/strict";
import test from "node:test";

import {
  postgresConnectionConfig,
  postgresMigrationUrl,
} from "../lib/postgres-connection.ts";

test("documented loopback URLs work without TLS", () => {
  const config = postgresConnectionConfig(
    "postgresql://postgres:postgres@localhost:5432/openoak",
    {},
  );

  assert.equal(config.ssl, false);
  assert.equal(new URL(config.connectionString).searchParams.has("sslmode"), false);
  assert.equal(
    new URL(postgresMigrationUrl(config.connectionString, {})).searchParams.get("sslmode"),
    "disable",
  );
});
test("remote and legacy require URLs are upgraded to verified TLS without conflicting query settings", () => {
  const config = postgresConnectionConfig(
    "postgresql://user:secret@db.example.com:5432/openoak?sslmode=require&application_name=openoak",
    {},
  );
  const url = new URL(config.connectionString);

  assert.equal(url.searchParams.has("sslmode"), false);
  assert.equal(url.searchParams.get("application_name"), "openoak");
  assert.notEqual(config.ssl, false);
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(
    new URL(postgresMigrationUrl(config.connectionString, {})).searchParams.get("sslmode"),
    "verify-full",
  );
});

test("unverified TLS cannot be selected for a remote production database", () => {
  assert.throws(
    () =>
      postgresConnectionConfig("postgresql://db.example.com/openoak", {
        POSTGRES_SSL_MODE: "disable",
      }),
    /only allowed for loopback/,
  );
});

test("local verified TLS accepts an escaped custom CA", () => {
  const config = postgresConnectionConfig("postgresql://localhost/openoak", {
    POSTGRES_SSL_MODE: "verify-full",
    POSTGRES_SSL_CA: "-----BEGIN CERTIFICATE-----\\nlocal-ca\\n-----END CERTIFICATE-----",
  });

  assert.notEqual(config.ssl, false);
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.match(config.ssl.ca, /CERTIFICATE-----\nlocal-ca\n-----END/);
});

test("hostname verification rejects a mismatched certificate", () => {
  const config = postgresConnectionConfig("postgresql://db.example.com/openoak", {});
  assert.notEqual(config.ssl, false);
  const certificate = {
    subject: { CN: "other.example.com" },
    subjectaltname: "DNS:other.example.com",
  };

  assert.ok(config.ssl.checkServerIdentity("db.example.com", certificate));
  assert.equal(config.ssl.checkServerIdentity("other.example.com", certificate), undefined);
});
