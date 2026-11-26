import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { UNVERIFIED_ACCOUNT_MAX_AGE_MS } from "@/lib/signup-protection";

export const dynamic = "force-dynamic";

function authorized(request: Request, secret: string) {
  const given = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// Daily job (vercel.json): removes accounts that never verified their email,
// and expired verification and reset tokens. Unverified accounts cannot sign
// in, so they own no app data. Their sessions and accounts cascade.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return Response.json({ error: "CRON_SECRET is not set." }, { status: 503 });
  if (!authorized(request, secret)) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const cutoff = new Date(Date.now() - UNVERIFIED_ACCOUNT_MAX_AGE_MS);
  const users = await prisma.user.deleteMany({ where: { emailVerified: false, createdAt: { lt: cutoff } } });
  const tokens = await prisma.verification.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  console.info(JSON.stringify({ job: "cleanup-unverified", deletedUsers: users.count, deletedTokens: tokens.count }));
  return Response.json({ deletedUsers: users.count, deletedTokens: tokens.count }, { headers: { "Cache-Control": "no-store" } });
}
