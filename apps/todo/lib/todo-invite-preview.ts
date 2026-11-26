import { prisma } from "@/lib/prisma";
import { verifyTodoInviteToken } from "@/lib/todo-invites";

export async function getTodoInvitePreview(token: string) {
  const claims = verifyTodoInviteToken(token);
  if (!claims) return null;
  return prisma.list.findFirst({
    where: {
      kind: "CUSTOM",
      inviteEnabled: true,
      inviteNonce: claims.nonce,
    },
    select: {
      id: true,
      name: true,
      owner: { select: { displayName: true, email: true } },
    },
  });
}
