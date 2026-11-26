import { suiteTrustedOrigins } from "../../../shared/suite-config";
import { requireAuthSecret } from "../../../shared/auth-secret";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { centralPrisma } from "./central-prisma";
import { authCookiePrefix, usesSharedAuth } from "./auth-mode";

// Session reader only. Sign-up, sign-in, password reset and email verification
// live on account.openoak.org. This instance validates the shared
// parent-domain cookie against the central account DB and powers get-session /
// sign-out for this app. It must match the account app's secret and cookie
// config so it reads the same cookie.
const appUrl =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

const secret = requireAuthSecret(process.env, "development_secret_only_for_local_builds");

const cookieDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();
const localTrustedOrigins = (() => {
  if (process.env.NODE_ENV === "production") return [];
  try {
    const url = new URL(appUrl);
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return [];
    const alternate = new URL(url);
    alternate.hostname = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
    return [alternate.origin];
  } catch {
    return [];
  }
})();

export const auth = betterAuth({
  database: prismaAdapter(centralPrisma, {
    provider: "postgresql",
  }),
  secret,
  baseURL: appUrl,
  trustedOrigins: [...suiteTrustedOrigins(), ...localTrustedOrigins],
  emailAndPassword: {
    enabled: !usesSharedAuth,
    minPasswordLength: 8,
  },
  advanced: {
    cookiePrefix: authCookiePrefix,
    useSecureCookies: appUrl.startsWith("https://"),
    crossSubDomainCookies: usesSharedAuth && cookieDomain
      ? {
          enabled: true,
          domain: cookieDomain,
        }
      : undefined,
  },
  user: { modelName: "User" },
  session: {
    modelName: "Session",
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
  },
  account: { modelName: "Account" },
  verification: { modelName: "Verification" },
});
