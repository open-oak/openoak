"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";

export async function revokeConnectedAiClient(formData: FormData) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Unauthorized");
  const consentId = String(formData.get("consentId") || "");
  if (!consentId) return;

  await prisma.$transaction(async (tx) => {
    const consent = await tx.oauthConsent.findFirst({
      where: { id: consentId, userId: session.user.id },
      select: { id: true, clientId: true },
    });
    if (!consent) return;
    const revokedAt = new Date();
    await tx.oauthAccessToken.updateMany({
      where: { clientId: consent.clientId, userId: session.user.id, revoked: null },
      data: { revoked: revokedAt },
    });
    await tx.oauthRefreshToken.updateMany({
      where: { clientId: consent.clientId, userId: session.user.id, revoked: null },
      data: { revoked: revokedAt },
    });
    await tx.oauthRevocation.upsert({
      where: { userId_clientId: { userId: session.user.id, clientId: consent.clientId } },
      create: { userId: session.user.id, clientId: consent.clientId, revokedAt },
      update: { revokedAt },
    });
    await tx.oauthConsent.deleteMany({
      where: { userId: session.user.id, clientId: consent.clientId },
    });
  });

  revalidatePath("/connected-ai");
}
