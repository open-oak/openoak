import { suiteTrustedOrigins } from "../../../shared/suite-config";
import { requireAuthSecret } from "../../../shared/auth-secret";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { centralPrisma } from "./central-prisma";
import { authCookiePrefix, usesSharedAuth } from "./auth-mode";

const appUrl =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

const secret = requireAuthSecret(process.env, "development_secret_only_for_local_builds");

const cookieDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();

export const auth = betterAuth({
  database: prismaAdapter(centralPrisma, {
    provider: "postgresql",
  }),
  secret,
  baseURL: appUrl,
  trustedOrigins: suiteTrustedOrigins(),
  emailAndPassword: { enabled: !usesSharedAuth, minPasswordLength: 8 },
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
