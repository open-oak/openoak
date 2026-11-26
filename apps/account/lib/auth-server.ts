import { suiteTrustedOrigins } from "../../../shared/suite-config";
import { requireAuthSecret } from "../../../shared/auth-secret";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "./cimd-fetch";
import {
  deliverPasswordChangedEmail,
  deliverPasswordResetEmail,
  deliverVerificationEmail,
  EMAIL_NOT_CONFIGURED,
  emailTransport,
} from "./email";
import { prisma } from "./prisma";
import { isBotRequest } from "./bot-check";
import { claimEmailSend } from "./email-cooldown";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordPolicyError } from "./password-policy";
import {
  AUTH_RATE_LIMIT_RULES,
  BOT_PROTECTED_AUTH_PATHS,
  PASSWORD_FIELD_BY_PATH,
  rateLimitStorage,
} from "./signup-protection";

export const accountIssuer = (process.env.BETTER_AUTH_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")).replace(/\/$/, "");
const appUrl = accountIssuer;
const secret = requireAuthSecret(process.env, "development_secret_only_for_local_builds");
const cookieDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();
const mcpResource = (process.env.MCP_RESOURCE_URL || "https://mcp.openoak.org").replace(/\/$/, "");
const mcpResourceAudiences = [mcpResource, `${mcpResource}/`];
const oauthScopes = ["openid", "offline_access", "openoak:read", "openoak:write"];

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  secret,
  baseURL: appUrl,
  emailVerification: {
    sendOnSignUp: true,
    expiresIn: 60 * 60,
    autoSignInAfterVerification: false,
    redirectTo: "/verify-email",
    sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
      if (!(await claimEmailSend("verification", user.email))) {
        console.warn("Verification email skipped: per-address cooldown is active.");
        return;
      }
      try {
        await deliverVerificationEmail(user.email, url);
      } catch (error) {
        console.error("Error sending verification email:", error);
        throw error;
      }
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: MIN_PASSWORD_LENGTH,
    maxPasswordLength: MAX_PASSWORD_LENGTH,
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }: { user: { email: string }; url: string }) => {
      if (!(await claimEmailSend("password-reset", user.email))) {
        console.warn("Password reset email skipped: per-address cooldown is active.");
        return;
      }
      try {
        await deliverPasswordResetEmail(user.email, url);
      } catch (error) {
        console.error("Error sending reset password email:", error);
        throw error;
      }
    },
    onPasswordReset: async ({ user }: { user: { email: string } }) => {
      try {
        await deliverPasswordChangedEmail(user.email, `${appUrl}/forgot-password`);
      } catch (error) {
        // The password is already changed at this point, so a delivery problem
        // must not turn a successful reset into a misleading failure response.
        console.error("Error sending password changed email:", error);
      }
    },
  },
  rateLimit: {
    // Serverless instances do not share memory, so keep the counters in the
    // database wherever migrations run (see rateLimitStorage).
    storage: rateLimitStorage(),
    modelName: "RateLimit",
    window: 60,
    max: 10,
    customRules: AUTH_RATE_LIMIT_RULES,
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const needsEmail = ctx.path === "/sign-up/email"
        || ctx.path === "/send-verification-email"
        || ctx.path === "/request-password-reset";
      if (needsEmail && !emailTransport()) {
        throw new APIError("SERVICE_UNAVAILABLE", { message: EMAIL_NOT_CONFIGURED });
      }

      // Internal server calls have no request and need no bot or password check.
      if (!ctx.request) return;
      if ((BOT_PROTECTED_AUTH_PATHS as readonly string[]).includes(ctx.path) && await isBotRequest(ctx.request.headers)) {
        throw new APIError("FORBIDDEN", { message: "We could not verify this request. Reload the page and try again." });
      }
      const passwordField = PASSWORD_FIELD_BY_PATH[ctx.path];
      const password = passwordField ? (ctx.body as Record<string, unknown> | undefined)?.[passwordField] : undefined;
      if (typeof password === "string") {
        const error = passwordPolicyError(password);
        if (error) throw new APIError("BAD_REQUEST", { message: error });
      }
    }),
  },
  trustedOrigins: suiteTrustedOrigins(),
  advanced: {
    cookiePrefix: process.env.AUTH_COOKIE_PREFIX?.trim() || "openoak",
    useSecureCookies: appUrl.startsWith("https://"),
    crossSubDomainCookies: cookieDomain
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
  plugins: [
    jwt({ jwt: { issuer: appUrl } }),
    oauthProvider({
      loginPage: "/login",
      consentPage: "/oauth/consent",
      scopes: oauthScopes,
      grantTypes: ["authorization_code", "refresh_token"],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultScopes: oauthScopes,
      clientRegistrationDefaultResources: mcpResourceAudiences,
      clientRegistrationAllowedResources: mcpResourceAudiences,
      resources: mcpResourceAudiences.map((identifier) => ({
        identifier,
        name: "OpenOak MCP",
        // Resource policy intersects the requested scopes. Keep the OIDC and
        // offline scopes here so an audience-bound token can still carry
        // identity claims and receive a refresh token.
        allowedScopes: oauthScopes,
        accessTokenTtl: 60 * 60,
        refreshTokenTtl: 60 * 60 * 24 * 30,
      })),
      resourceSeedMode: "merge",
      enforcePerClientResources: true,
    }),
    cimd({
      fetchClientMetadataResource,
      metadataProfile: "mcp-2026-07-28",
    }),
    nextCookies(),
  ],
});
