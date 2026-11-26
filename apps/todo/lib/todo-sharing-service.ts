import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { createInviteNonce } from "@/lib/todo-invites";
import type { TodoInviteClaims } from "@/lib/todo-invites";

export type InviteMode = "enable" | "rotate" | "disable";

export async function configureListInviteForOwner(listId: string, ownerId: string, mode: InviteMode) {
  return prisma.$transaction(async (tx) => {
    const list = await tx.list.findFirst({
      where: { id: listId, ownerId, kind: "CUSTOM" },
      select: { id: true, inviteEnabled: true, inviteNonce: true },
    });
    if (!list) return null;
    const nonce = mode === "disable"
      ? null
      : mode === "enable" && list.inviteEnabled && list.inviteNonce
        ? list.inviteNonce
        : createInviteNonce();
    return tx.list.update({
      where: { id: list.id },
      data: { inviteEnabled: mode !== "disable", inviteNonce: nonce },
      select: { id: true, inviteEnabled: true, inviteNonce: true },
    });
  });
}
export async function acceptTodoInviteClaimsForUser(claims: TodoInviteClaims, userId: string) {
  return prisma.$transaction(async (tx) => {
    const list = await tx.list.findFirst({
      where: {
        kind: "CUSTOM",
        inviteEnabled: true,
        inviteNonce: claims.nonce,
      },
      select: { id: true, ownerId: true },
    });
    if (!list) return null;
    if (list.ownerId === userId) return { listId: list.id, accessLevel: "owner" as const };

    // This conditional write serializes acceptance with invite rotation or
    // disabling. A nonce changed while waiting cannot insert membership.
    const validAtWrite = await tx.list.updateMany({
      where: {
        id: list.id,
        kind: "CUSTOM",
        inviteEnabled: true,
        inviteNonce: claims.nonce,
      },
      data: { updatedAt: new Date() },
    });
    if (validAtWrite.count !== 1) return null;
    await tx.listMember.upsert({
      where: { listId_userId: { listId: list.id, userId } },
      create: { listId: list.id, userId },
      update: {},
    });
    return { listId: list.id, accessLevel: "editor" as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function removeListMemberForOwner(listId: string, ownerId: string, memberUserId: string) {
  return prisma.$transaction(async (tx) => {
    const list = await tx.list.findFirst({
      where: { id: listId, ownerId, kind: "CUSTOM" },
      select: { id: true, ownerId: true },
    });
    if (!list || memberUserId === list.ownerId) return false;
    await tx.listMember.deleteMany({ where: { listId: list.id, userId: memberUserId } });
    await tx.list.update({ where: { id: list.id }, data: { updatedAt: new Date() } });
    return true;
  });
}

export async function leaveTodoList(listId: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const list = await tx.list.findFirst({
      where: { id: listId, kind: "CUSTOM", ownerId: { not: userId } },
      select: { id: true },
    });
    if (!list) return false;
    const result = await tx.listMember.deleteMany({ where: { listId: list.id, userId } });
    if (result.count === 0) return false;
    await tx.list.update({ where: { id: list.id }, data: { updatedAt: new Date() } });
    return true;
  });
}
