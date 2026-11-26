"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyPassword } from "better-auth/crypto";
import { auth } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import { deletionSchemas, deleteSuiteAccountData } from "@/lib/account-deletion";

export async function deleteMyAccount(_previous: { error: string }, form: FormData): Promise<{ error: string }> {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return { error: "Sign in again before deleting your account." };
  const schemas = deletionSchemas(process.env.ACCOUNT_DELETION_SCHEMAS);
  if (!schemas) return { error: "Contact support to delete your account on this installation." };
  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");
  if (email.toLowerCase() !== session.user.email.toLowerCase() || !password || password.length > 128) return { error: "Enter your account email and current password." };
  // Count attempts outside the deletion transaction, so a wrong password does
  // not roll back its own rate limit. The counter contains no password or token.
  const attemptId = `delete-attempt:${session.user.id}`;
  const attempts = await prisma.$queryRawUnsafe<Array<{ value: string }>>(`
    WITH actor AS (SELECT id FROM "${schemas.account}"."User" WHERE id=$2 FOR KEY SHARE)
    INSERT INTO "${schemas.account}"."Verification" (id,identifier,value,"expiresAt","createdAt","updatedAt")
    SELECT $1,$1,'1',CURRENT_TIMESTAMP+INTERVAL '15 minutes',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP FROM actor
    ON CONFLICT (id) DO UPDATE SET
      value=CASE WHEN "Verification"."expiresAt"<=CURRENT_TIMESTAMP THEN '1' ELSE LEAST("Verification".value::int+1,1000)::text END,
      "expiresAt"=CASE WHEN "Verification"."expiresAt"<=CURRENT_TIMESTAMP THEN CURRENT_TIMESTAMP+INTERVAL '15 minutes' ELSE "Verification"."expiresAt" END,
      "updatedAt"=CURRENT_TIMESTAMP RETURNING value`, attemptId, session.user.id);
  if (!attempts.length) return { error: "Sign in again before deleting your account." };
  if (Number(attempts[0]?.value) > 5) return { error: "Too many attempts. Wait 15 minutes and try again." };

  let invalidPassword = false;
  try {
    await prisma.$transaction(async (tx) => {
      await deleteSuiteAccountData({ query: (sql, ...values) => tx.$queryRawUnsafe(sql, ...values), execute: (sql, ...values) => tx.$executeRawUnsafe(sql, ...values) }, schemas, session.user.id, async () => {
        const account = await tx.account.findFirst({ where: { userId: session.user.id, providerId: "credential" }, select: { password: true } });
        if (!account?.password || !await verifyPassword({ hash: account.password, password })) {
          invalidPassword = true;
          throw new Error("Identity verification failed");
        }
      });
    }, { isolationLevel: "ReadCommitted", timeout: 30_000 });
  } catch {
    return { error: invalidPassword ? "The password is incorrect." : "Could not delete your account. No deletion was committed. Contact support if this continues." };
  }
  await auth.api.signOut({ headers: requestHeaders });
  redirect("/login?deleted=1");
}
