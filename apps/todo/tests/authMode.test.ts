import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const authModeSource = readFileSync(
  resolve(__dirname, "../lib/auth-mode.ts"),
  "utf8",
);

async function loadAuthMode({
  accountDatabaseUrl = "",
  accountUrl = "",
}: {
  accountDatabaseUrl?: string;
  accountUrl?: string;
}) {
  vi.resetModules();
  vi.stubEnv("ACCOUNT_DATABASE_URL", accountDatabaseUrl);
  vi.stubEnv("NEXT_PUBLIC_ACCOUNT_URL", accountUrl);
  return import("@/lib/auth-mode");
}

describe.sequential("Todo authentication modes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses the Todo origin for standalone sign-in", async () => {
    const { loginUrl, usesSharedAuth } = await loadAuthMode({});
    expect(usesSharedAuth).toBe(false);
    expect(loginUrl("https://todo.example.test/lists/one").toString()).toBe(
      "https://todo.example.test/login",
    );
  });

  it("uses the account origin for hosted shared authentication", async () => {
    const { accountUrl, loginUrl, usesSharedAuth } = await loadAuthMode({
      accountDatabaseUrl: "postgresql://account-db",
      accountUrl: "https://account.openoak.org",
    });
    expect(usesSharedAuth).toBe(true);
    expect(accountUrl).toBe("https://account.openoak.org");
    expect(loginUrl("https://todo.openoak.org/lists/one").toString()).toBe(
      "https://account.openoak.org/login",
    );
  });

  it("never falls back to the Todo origin for hosted sign-in", () => {
    const rejectsMissingAccountUrl = authModeSource.includes(
      "if (usesSharedAuth && !accountUrl)",
    );
    const hasCanonicalHostedDefault = authModeSource.includes(
      '|| "https://account.openoak.org"',
    );
    expect(rejectsMissingAccountUrl || hasCanonicalHostedDefault).toBe(true);
  });
});
