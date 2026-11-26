"use server";

import { revalidatePath } from "next/cache";
import { ensureTodoProfile } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { genericUnavailableMessage } from "@/lib/todo-access";
import { verifyTodoInviteToken } from "@/lib/todo-invites";
import {
  acceptTodoInviteClaimsForUser,
  configureListInviteForOwner,
  leaveTodoList,
  removeListMemberForOwner,
} from "@/lib/todo-sharing-service";

export interface SharingMember {
  userId: string;
  displayName: string;
  email: string | null;
  joinedAt: Date;
}

export type ListSharingDetails =
  | {
      ok: true;
      listId: string;
      listName: string;
      accessLevel: "owner" | "editor";
      ownerDisplay: string;
      inviteEnabled: boolean;
      invitePath: string | null;
      members: SharingMember[];
    }
  | { ok: false; error: string };

const unavailable = { ok: false, error: genericUnavailableMessage } as const;

function revalidateSharingViews(listId: string) {
  revalidatePath("/", "layout");
  revalidatePath(`/lists/${listId}`, "page");
}

function invitePath(nonce: string | null, enabled: boolean) {
  return enabled && nonce ? `/i/${encodeURIComponent(nonce)}` : null;
}

export async function getListSharing(listId: string): Promise<ListSharingDetails> {
  const user = await ensureTodoProfile();
  const list = await prisma.list.findFirst({
    where: {
      id: listId,
      kind: "CUSTOM",
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    select: {
      id: true,
      name: true,
      ownerId: true,
      inviteEnabled: true,
      inviteNonce: true,
      owner: { select: { displayName: true, email: true } },
      members: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          userId: true,
          createdAt: true,
          user: { select: { displayName: true, email: true } },
        },
      },
    },
  });
  if (!list) return unavailable;

  const isOwner = list.ownerId === user.id;
  return {
    ok: true,
    listId: list.id,
    listName: list.name,
    accessLevel: isOwner ? "owner" : "editor",
    ownerDisplay: isOwner ? "You" : list.owner.displayName || list.owner.email || "List owner",
    inviteEnabled: isOwner && list.inviteEnabled,
    invitePath: isOwner ? invitePath(list.inviteNonce, list.inviteEnabled) : null,
    members: list.members.map((member) => ({
      userId: member.userId,
      displayName: member.user.displayName || member.user.email || "Member",
      email: member.user.email,
      joinedAt: member.createdAt,
    })),
  };
}

async function setInvite(listId: string, mode: "enable" | "rotate" | "disable") {
  const user = await ensureTodoProfile();
  const updated = await configureListInviteForOwner(listId, user.id, mode);
  if (!updated) return unavailable;
  revalidateSharingViews(listId);
  return {
    ok: true as const,
    inviteEnabled: updated.inviteEnabled,
    invitePath: invitePath(updated.inviteNonce, updated.inviteEnabled),
  };
}

export async function enableListInvite(listId: string) {
  return setInvite(listId, "enable");
}

export async function rotateListInvite(listId: string) {
  return setInvite(listId, "rotate");
}

export async function disableListInvite(listId: string) {
  return setInvite(listId, "disable");
}

export async function removeListMember(listId: string, memberUserId: string) {
  const user = await ensureTodoProfile();
  const removed = await removeListMemberForOwner(listId, user.id, memberUserId);
  if (!removed) return unavailable;
  revalidateSharingViews(listId);
  return { ok: true as const };
}

export async function leaveSharedList(listId: string) {
  const user = await ensureTodoProfile();
  const left = await leaveTodoList(listId, user.id);
  if (!left) return unavailable;
  revalidateSharingViews(listId);
  return { ok: true as const };
}

export async function acceptTodoInvite(token: string) {
  const claims = verifyTodoInviteToken(token);
  if (!claims) return unavailable;
  const user = await ensureTodoProfile();

  try {
    const result = await acceptTodoInviteClaimsForUser(claims, user.id);
    if (!result) return unavailable;
    revalidateSharingViews(result.listId);
    return { ok: true as const, ...result };
  } catch (error) {
    console.error("acceptTodoInvite failed:", error);
    return unavailable;
  }
}
