import { prisma } from "./prisma";
import { emailCooldownKey, nextCooldownState, rateLimitStorage, type EmailKind } from "./signup-protection";

/**
 * Returns true when another email of this kind may go to this address now.
 * Uses the shared RateLimit table. A database error allows the send, because
 * the per-IP limits and BotID still apply and a lost verification email locks
 * a real person out.
 */
export async function claimEmailSend(kind: EmailKind, email: string) {
  // Without the RateLimit table, only the per-IP memory limits apply.
  if (rateLimitStorage() !== "database") return true;
  const key = await emailCooldownKey(kind, email);
  try {
    const row = await prisma.rateLimit.findUnique({ where: { key } });
    const next = nextCooldownState(row, BigInt(Date.now()));
    if (!next.allowed) return false;
    if (!row) {
      await prisma.rateLimit.create({ data: { key, count: next.count, lastRequest: next.lastRequest } });
    } else {
      // Compare-and-set on the old count, so parallel requests cannot both pass.
      const updated = await prisma.rateLimit.updateMany({
        where: { key, count: row.count, lastRequest: row.lastRequest },
        data: { count: next.count, lastRequest: next.lastRequest },
      });
      if (updated.count === 0) return false;
    }
    return true;
  } catch (error) {
    // A unique-key race on create means a parallel request claimed the slot.
    if ((error as { code?: string }).code === "P2002") return false;
    console.error("Email cooldown check failed; sending anyway:", error);
    return true;
  }
}
