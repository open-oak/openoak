import type { Prisma } from "../generated/prisma/client";

export async function moveNoteToTrash(tx: Prisma.TransactionClient, ownerId: string, noteId: string, expectedUpdatedAt?: Date) {
  const note = await tx.note.findFirst({ where: { id: noteId, ownerId, ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}) } });
  if (!note) return false;
  const { id, ...snapshot } = note;
  await tx.noteTrash.create({ data: { ...snapshot, noteId: id } });
  const deleted = await tx.note.deleteMany({ where: { id, ownerId, updatedAt: note.updatedAt } });
  if (deleted.count !== 1) throw new Error("The note changed. Reload it before deleting.");
  return true;
}

export async function restoreTrashedNote(tx: Prisma.TransactionClient, ownerId: string, trashId: string) {
  const note = await tx.noteTrash.findFirst({ where: { id: trashId, ownerId } });
  if (!note) throw new Error("This deleted note is unavailable.");
  const { id, noteId, ...snapshot } = note;
  delete (snapshot as Partial<typeof snapshot>).deletedAt;
  const restored = await tx.note.create({ data: { ...snapshot, id: noteId, updatedAt: new Date() } });
  await tx.noteTrash.delete({ where: { id } });
  return restored;
}
