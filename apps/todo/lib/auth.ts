import { cache } from "react";
import { prisma } from "./prisma";
import { auth } from "./auth-server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { accountUrl, usesSharedAuth } from "./auth-mode";

// Validate the shared central session, then resolve this app's profile keyed by
// the central user id. Creates the Todo profile and a default list on first
// visit. All ownership checks use the returned id (the central user id).
export const ensureTodoProfile = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(usesSharedAuth ? `${accountUrl}/login` : "/login");

  const identity = {
    displayName: session.user.name || null,
    email: session.user.email || null,
  };

  // Fast path: one read on every request. Write only when this is a first
  // visit, the identity changed, or the default list is missing.
  const existing = await prisma.todoProfile.findUnique({
    where: { id: session.user.id },
    include: { ownedLists: { where: { kind: "DEFAULT" }, select: { id: true }, take: 1 } },
  });
  if (existing) {
    const { ownedLists, ...profile } = existing;
    if (
      ownedLists.length > 0
      && profile.displayName === identity.displayName
      && profile.email === identity.email
    ) {
      return profile;
    }
  }

  return prisma.$transaction(async (tx) => {
    const profile = await tx.todoProfile.upsert({
      where: { id: session.user.id },
      create: { id: session.user.id, ...identity },
      update: identity,
    });

    const defaultList = await tx.list.findFirst({
      where: { ownerId: profile.id, kind: "DEFAULT" },
      select: { id: true },
    });
    if (!defaultList) {
      await tx.list.create({
        data: {
          name: "Tasks",
          ownerId: profile.id,
          kind: "DEFAULT",
        },
      });
    }

    return profile;
  });
});
