import { randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client";
import { prisma } from "./prisma";
import { MAX_TODO_SORT_ORDER } from "./todo-validation";
import type { ImportDocument, ImportedTask } from "./todo-import";

export type ImportSummary = {
  listsCreated: number;
  listsUpdated: number;
  tasksImported: number;
  tasksSkipped: number;
  stepsImported: number;
  flaggedEmailListsSkipped: number;
  attachmentsSkipped: number;
};

const TASK_BATCH_SIZE = 500;

/** A task already in the target list with the same title (and, when known, the same creation time) is not imported again. */
export function importTaskKey(title: string, createdAt: Date | null) {
  return createdAt ? `${title}\u0000${createdAt.toISOString()}` : title;
}

/**
 * Write an import document into the user's own lists. Each source list goes into
 * an owned list with the same name (created when missing); the source default
 * list goes into the OpenTodo default list. Tasks that were imported before are
 * skipped, so a repeat import is safe.
 */
export async function applyImport(userId: string, document: ImportDocument): Promise<ImportSummary> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('openoak:todo:import:' || ${userId}::text, 0))`;
    return applyImportToOwnedLists(tx, userId, document);
  }, { isolationLevel: "ReadCommitted", timeout: 60_000 });
}

async function applyImportToOwnedLists(
  tx: Prisma.TransactionClient,
  userId: string,
  document: ImportDocument,
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    listsCreated: 0,
    listsUpdated: 0,
    tasksImported: 0,
    tasksSkipped: 0,
    stepsImported: 0,
    flaggedEmailListsSkipped: document.skipped.flaggedEmailLists,
    attachmentsSkipped: document.skipped.attachments,
  };

  const ownedLists = await tx.list.findMany({
    where: { ownerId: userId },
    select: { id: true, name: true, kind: true, sortOrder: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const defaultList = ownedLists.find((list) => list.kind === "DEFAULT") ?? null;
  const byName = new Map<string, string>();
  for (const list of ownedLists) {
    if (list.kind === "CUSTOM" && !byName.has(list.name.toLowerCase())) byName.set(list.name.toLowerCase(), list.id);
  }
  let nextListSort = ownedLists.reduce((max, list) => Math.max(max, list.sortOrder), -1) + 1;

  for (const source of document.lists) {
    let listId = source.isDefault ? defaultList?.id ?? null : null;
    if (!listId) listId = byName.get(source.name.toLowerCase()) ?? null;
    let created = false;
    if (!listId) {
      if (source.tasks.length === 0) continue;
      const list = await tx.list.create({
        data: { name: source.name, ownerId: userId, kind: "CUSTOM", sortOrder: Math.min(nextListSort, MAX_TODO_SORT_ORDER) },
        select: { id: true },
      });
      nextListSort += 1;
      listId = list.id;
      byName.set(source.name.toLowerCase(), listId);
      created = true;
      summary.listsCreated += 1;
    }

    const existing = await tx.task.findMany({
      where: { listId },
      select: { title: true, createdAt: true },
    });
    const existingKeys = new Set<string>();
    for (const task of existing) {
      existingKeys.add(importTaskKey(task.title, task.createdAt));
      existingKeys.add(importTaskKey(task.title, null));
    }

    const fresh: ImportedTask[] = [];
    for (const task of source.tasks) {
      const key = importTaskKey(task.title, task.createdAt);
      if (existingKeys.has(key)) {
        summary.tasksSkipped += 1;
        continue;
      }
      existingKeys.add(key);
      fresh.push(task);
    }
    if (fresh.length === 0) continue;

    const maxSort = await tx.task.aggregate({ where: { listId }, _max: { sortOrder: true } });
    let nextSort = (maxSort._max?.sortOrder ?? -1) + 1;

    for (let start = 0; start < fresh.length; start += TASK_BATCH_SIZE) {
      const batch = fresh.slice(start, start + TASK_BATCH_SIZE);
      // Assign IDs so steps can reference their task without relying on insert order.
      const rows = batch.map((task) => ({ id: `imp${randomUUID().replace(/-/g, "")}`, task }));
      await tx.task.createMany({
        data: rows.map(({ id, task }) => ({
          id,
          title: task.title,
          notes: task.notes,
          dueDate: task.dueDate,
          isCompleted: task.isCompleted,
          isImportant: task.isImportant,
          isMyDay: false,
          listId,
          createdById: userId,
          sortOrder: Math.min(nextSort++, MAX_TODO_SORT_ORDER),
          ...(task.createdAt ? { createdAt: task.createdAt } : {}),
        })),
      });
      const steps = rows.flatMap(({ id, task }) => task.steps.map((step, sortOrder) => ({
        taskId: id,
        title: step.title,
        isCompleted: step.isCompleted,
        sortOrder,
      })));
      if (steps.length) await tx.subtask.createMany({ data: steps });
      summary.stepsImported += steps.length;
      summary.tasksImported += rows.length;
    }

    await tx.list.update({ where: { id: listId }, data: { updatedAt: new Date() } });
    if (!created) summary.listsUpdated += 1;
  }

  return summary;
}
