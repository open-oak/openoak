// Abuse controls for the public auth endpoints. Better Auth matches these
// paths after it removes its "/api/auth" base path, so they must not include it.

/** Endpoints that send email or accept credentials. BotID checks these. */
export const BOT_PROTECTED_AUTH_PATHS = [
  "/sign-up/email",
  "/sign-in/email",
  "/request-password-reset",
  "/send-verification-email",
] as const;

/** Browser routes for `initBotId`; these include the base path. */
export const BOT_PROTECTED_ROUTES = BOT_PROTECTED_AUTH_PATHS.map((path) => ({
  path: `/api/auth${path}`,
  method: "POST" as const,
}));

/** Per-IP limits. They are kept in the database so all instances share them. */
export const AUTH_RATE_LIMIT_RULES = {
  "/sign-up/email": { window: 600, max: 3 },
  "/sign-in/email": { window: 60, max: 5 },
  "/request-password-reset": { window: 600, max: 3 },
  "/send-verification-email": { window: 600, max: 3 },
  "/reset-password": { window: 600, max: 5 },
  "/oauth2/register": { window: 3600, max: 10 },
} as const;

/** Paths whose request body carries a new password. */
export const PASSWORD_FIELD_BY_PATH: Record<string, "password" | "newPassword"> = {
  "/sign-up/email": "password",
  "/reset-password": "newPassword",
  "/change-password": "newPassword",
};

export type EmailKind = "verification" | "password-reset";

/**
 * Per-address limit for outgoing email. Per-IP limits do not stop one script on
 * many IPs from flooding a single inbox; this does. The window must not exceed
 * the longest Better Auth rule window, because Better Auth prunes rows older
 * than that from the shared table.
 */
export const EMAIL_COOLDOWN = { windowMs: 600_000, max: 3 } as const;

export async function emailCooldownKey(kind: EmailKind, email: string) {
  const bytes = new TextEncoder().encode(email.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `email-cooldown:${kind}:${hex}`;
}

export type CooldownRow = { count: number; lastRequest: bigint } | null;

/** Pure decision for one send attempt, given the stored row. */
export function nextCooldownState(row: CooldownRow, now: bigint) {
  const windowMs = BigInt(EMAIL_COOLDOWN.windowMs);
  if (!row || now - row.lastRequest >= windowMs) return { allowed: true, count: 1, lastRequest: now };
  if (row.count >= EMAIL_COOLDOWN.max) return { allowed: false, count: row.count, lastRequest: row.lastRequest };
  return { allowed: true, count: row.count + 1, lastRequest: row.lastRequest };
}

/**
 * The RateLimit table exists only where migrations run. This mirrors
 * scripts/vercel-build.mjs: Vercel Preview skips migrations unless its
 * database is confirmed isolated, so it keeps per-instance memory counters.
 * Everywhere else (Production, local, self-hosted) migrations are required.
 */
export function rateLimitStorage(env: Record<string, string | undefined> = process.env): "database" | "memory" {
  if (env.VERCEL_ENV === "preview" && env.PREVIEW_DATABASE_ISOLATED !== "true") return "memory";
  return "database";
}

/** BotID only works behind Vercel's proxy. Self-hosted installs skip it. */
export function botIdEnabled(env: Record<string, string | undefined> = process.env) {
  if (env.BOTID_ENABLED === "false") return false;
  return env.VERCEL === "1" || env.BOTID_ENABLED === "true";
}

/** Unverified accounts older than this are removed by the daily cleanup job. */
export const UNVERIFIED_ACCOUNT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
