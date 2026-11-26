import type { Prisma, Task, Subtask, TaskPersonalState } from "../generated/prisma/client";
import { editableListWhere, editableTaskWhere } from "./todo-access";

type Snapshot = Task & { subtasks: Subtask[]; personalStates: TaskPersonalState[] };

export async function moveTaskToTrash(tx: Prisma.TransactionClient, userId: string, taskId: string, expectedUpdatedAt?: Date) {
  const task = await tx.task.findFirst({
    where: { id: taskId, ...editableTaskWhere(userId), ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}) },
    include: { subtasks: true, personalStates: true },
  });
  if (!task) return false;
  await tx.taskTrash.create({ data: {
    taskId: task.id, listId: task.listId, createdById: task.createdById, title: task.title,
    snapshot: JSON.parse(JSON.stringify(task)) as Prisma.InputJsonValue,
  } });
  const deleted = await tx.task.deleteMany({ where: { id: task.id, updatedAt: task.updatedAt, ...editableTaskWhere(userId) } });
  if (deleted.count !== 1) throw new Error("The task changed. Reload it before deleting.");
  return true;
}

export async function restoreTrashedTask(tx: Prisma.TransactionClient, userId: string, trashId: string) {
  const trash = await tx.taskTrash.findFirst({ where: { id: trashId, list: editableListWhere(userId) } });
  if (!trash) throw new Error("This deleted task is unavailable.");
  const snapshot = trash.snapshot as unknown as Snapshot;
  if (snapshot.id !== trash.taskId || snapshot.listId !== trash.listId || snapshot.createdById !== trash.createdById
    || !Array.isArray(snapshot.subtasks) || !Array.isArray(snapshot.personalStates)) throw new Error("Invalid task recovery data.");
  const { subtasks, personalStates, ...task } = snapshot;
  // Account deletion and access removal must not resurrect another user's flags.
  const list = await tx.list.findUniqueOrThrow({ where: { id: trash.listId }, select: { ownerId: true, members: { select: { userId: true } } } });
  const audience = new Set([list.ownerId, ...list.members.map((member) => member.userId)]);
  const restored = await tx.task.create({ data: {
    ...task,
    createdAt: new Date(task.createdAt), updatedAt: new Date(), dueDate: task.dueDate ? new Date(task.dueDate) : null,
    subtasks: { create: subtasks.map((subtask) => ({ id: subtask.id, title: subtask.title, isCompleted: subtask.isCompleted, sortOrder: subtask.sortOrder, createdAt: new Date(subtask.createdAt), updatedAt: new Date(subtask.updatedAt) })) },
    personalStates: { create: personalStates.filter((state) => audience.has(state.userId)).map((state) => ({ userId: state.userId, isImportant: state.isImportant, isMyDay: state.isMyDay, createdAt: new Date(state.createdAt), updatedAt: new Date(state.updatedAt) })) },
  } });
  await tx.taskTrash.delete({ where: { id: trash.id } });
  await tx.list.update({ where: { id: trash.listId }, data: { updatedAt: new Date() } });
  return restored;
}
