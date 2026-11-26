import { describe, expect, it } from "vitest";

import {
  postgresConnectionConfig,
  postgresMigrationUrl,
} from "@/lib/postgres-connection";

describe("PostgreSQL connection security", () => {
  it("supports the documented loopback URL without TLS", () => {
    const config = postgresConnectionConfig(
      "postgresql://postgres:postgres@localhost:5432/openoak",
      {},
    );

    expect(config.ssl).toBe(false);
    expect(new URL(config.connectionString).searchParams.has("sslmode")).toBe(false);
    expect(
      new URL(postgresMigrationUrl(config.connectionString, {})!).searchParams.get("sslmode"),
    ).toBe("disable");
  });

  it("upgrades remote and legacy require URLs to verified TLS without conflicting query settings", () => {
    const config = postgresConnectionConfig(
      "postgresql://user:secret@db.example.com:5432/openoak?sslmode=require&application_name=openoak",
      {},
    );
    const url = new URL(config.connectionString);

    expect(url.searchParams.has("sslmode")).toBe(false);
    expect(url.searchParams.get("application_name")).toBe("openoak");
    expect(config.ssl).not.toBe(false);
    if (config.ssl === false) throw new Error("Expected verified TLS.");
    expect(config.ssl.rejectUnauthorized).toBe(true);
    expect(
      new URL(postgresMigrationUrl(config.connectionString, {})!).searchParams.get("sslmode"),
    ).toBe("verify-full");
  });

  it("rejects unverified TLS for a remote production database", () => {
    expect(() =>
      postgresConnectionConfig("postgresql://db.example.com/openoak", {
        POSTGRES_SSL_MODE: "disable",
      }),
    ).toThrow(/only allowed for loopback/);
  });

  it("supports local verified TLS with an escaped custom CA", () => {
    const config = postgresConnectionConfig("postgresql://localhost/openoak", {
      POSTGRES_SSL_MODE: "verify-full",
      POSTGRES_SSL_CA:
        "-----BEGIN CERTIFICATE-----\\nlocal-ca\\n-----END CERTIFICATE-----",
    });

    expect(config.ssl).not.toBe(false);
    if (config.ssl === false) throw new Error("Expected verified TLS.");
    expect(config.ssl.rejectUnauthorized).toBe(true);
    expect(config.ssl.ca).toMatch(/CERTIFICATE-----\nlocal-ca\n-----END/);
  });

  it("rejects a hostname-mismatched certificate", () => {
    const config = postgresConnectionConfig("postgresql://db.example.com/openoak", {});
    expect(config.ssl).not.toBe(false);
    if (config.ssl === false) throw new Error("Expected verified TLS.");
    const certificate = {
      subject: { CN: "other.example.com" },
      subjectaltname: "DNS:other.example.com",
    } as Parameters<typeof config.ssl.checkServerIdentity>[1];

    expect(config.ssl.checkServerIdentity("db.example.com", certificate)).toBeInstanceOf(Error);
    expect(config.ssl.checkServerIdentity("other.example.com", certificate)).toBeUndefined();
  });
});
