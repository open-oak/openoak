import { moveTaskToTrash } from "./task-recovery";
import { Prisma } from "../generated/prisma/client";
import { prisma } from "./prisma";
import {
  editableListWhere,
  editableSubtaskWhere,
  editableTaskWhere,
  personalFlagWhere,
  projectPersonalTaskFlags,
  readableListWhere,
  readableSubtaskWhere,
  readableTaskWhere,
} from "./todo-access";
import {
  cleanListName,
  cleanSubtaskTitle,
  cleanTaskNotes,
  cleanTaskTitle,
  MAX_TODO_SORT_ORDER,
} from "./todo-validation";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export type TodoMcpErrorCode = "invalid" | "not_found" | "conflict" | "invariant";

export class TodoMcpError extends Error {
  constructor(
    public readonly code: TodoMcpErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TodoMcpError";
  }
}

function pageSize(limit?: number) {
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit ?? DEFAULT_LIMIT)));
}

function parseCursor(cursor?: string) {
  if (!cursor) return 0;
  try {
    const value = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error();
    return value;
  } catch {
    throw new TodoMcpError("invalid", "Invalid pagination cursor.");
  }
}

function nextCursor(offset: number, hasMore: boolean, limit: number) {
  return hasMore ? Buffer.from(String(offset + limit)).toString("base64url") : undefined;
}

function expectedDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TodoMcpError("invalid", "expectedUpdatedAt must be an ISO timestamp.");
  return parsed;
}

function optionalDate(value: string | null | undefined) {
  if (value === null || value === undefined) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TodoMcpError("invalid", "dueDate must be an ISO timestamp or null.");
  return parsed;
}

function todoUrl(listId: string, taskId?: string) {
  const base = (process.env.TODO_PUBLIC_URL || "https://todo.openoak.org").replace(/\/$/, "");
  return `${base}/lists/${encodeURIComponent(listId)}${taskId ? `?task=${encodeURIComponent(taskId)}` : ""}`;
}

function serializeSubtask(subtask: {
  id: string;
  title: string;
  isCompleted: boolean;
  taskId: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: subtask.id,
    title: subtask.title,
    isCompleted: subtask.isCompleted,
    taskId: subtask.taskId,
    sortOrder: subtask.sortOrder,
    createdAt: subtask.createdAt.toISOString(),
    updatedAt: subtask.updatedAt.toISOString(),
  };
}

function serializeTask(task: {
  id: string;
  title: string;
  notes: string | null;
  dueDate: Date | null;
  isCompleted: boolean;
  isImportant: boolean;
  isMyDay: boolean;
  sortOrder: number;
  listId: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  personalStates?: Array<{ isImportant: boolean; isMyDay: boolean }>;
  subtasks?: Array<Parameters<typeof serializeSubtask>[0]>;
}, userId: string) {
  const personalized = projectPersonalTaskFlags(task, userId);
  return {
    id: personalized.id,
    title: personalized.title,
    notes: personalized.notes,
    dueDate: personalized.dueDate?.toISOString() ?? null,
    isCompleted: personalized.isCompleted,
    isImportant: personalized.isImportant,
    isMyDay: personalized.isMyDay,
    sortOrder: personalized.sortOrder,
    listId: personalized.listId,
    createdById: personalized.createdById,
    createdAt: personalized.createdAt.toISOString(),
    updatedAt: personalized.updatedAt.toISOString(),
    url: todoUrl(personalized.listId, personalized.id),
    subtasks: personalized.subtasks?.map(serializeSubtask),
  };
}

function serializeList(list: {
  id: string;
  name: string;
  themeColor: string | null;
  backgroundImage: string | null;
  sortOrder: number;
  ownerId: string;
  kind: "DEFAULT" | "CUSTOM";
  createdAt: Date;
  updatedAt: Date;
  owner?: { displayName: string | null; email: string | null };
  _count?: { tasks: number; members: number };
}, userId: string) {
  const owned = list.ownerId === userId;
  return {
    id: list.id,
    name: list.name,
    themeColor: list.themeColor,
    backgroundImage: list.backgroundImage,
    sortOrder: list.sortOrder,
    kind: list.kind,
    accessLevel: owned ? "owner" : "editor",
    ownerDisplay: owned ? "You" : list.owner?.displayName || list.owner?.email || "Shared list owner",
    shared: (list._count?.members ?? 0) > 0,
    memberCount: list._count?.members,
    taskCount: list._count?.tasks,
    createdAt: list.createdAt.toISOString(),
    updatedAt: list.updatedAt.toISOString(),
    url: todoUrl(list.id),
  };
}

const listInclude = {
  owner: { select: { displayName: true, email: true } },
  _count: { select: { tasks: true, members: true } },
} as const;

function taskInclude(userId: string) {
  return {
    subtasks: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] },
    personalStates: { where: { userId }, select: { isImportant: true, isMyDay: true }, take: 1 },
  };
}

async function ensureProfile(userId: string) {
  await prisma.todoProfile.upsert({ where: { id: userId }, create: { id: userId }, update: {} });
}

async function ensureDefaultList(userId: string) {
  await ensureProfile(userId);
  const current = await prisma.list.findFirst({ where: { ownerId: userId, kind: "DEFAULT" } });
  if (current) return current;
  return prisma.list.create({ data: { ownerId: userId, name: "Tasks", kind: "DEFAULT" } });
}

function personalFilter(userId: string, flag: "isImportant" | "isMyDay", value: boolean): Prisma.TaskWhereInput {
  const enabled = personalFlagWhere(userId, flag);
  return value ? enabled : { NOT: enabled };
}

export async function todoListLists(userId: string, input: { limit?: number; cursor?: string } = {}) {
  await ensureDefaultList(userId);
  const limit = pageSize(input.limit);
  const offset = parseCursor(input.cursor);
  const [owned, joined] = await Promise.all([
    prisma.list.findMany({ where: { ownerId: userId }, include: listInclude, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }] }),
    prisma.list.findMany({ where: { kind: "CUSTOM", members: { some: { userId } } }, include: listInclude, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
  ]);
  const lists = [...owned, ...joined];
  const page = lists.slice(offset, offset + limit);
  return { items: page.map((list) => serializeList(list, userId)), nextCursor: nextCursor(offset, lists.length > offset + limit, limit) };
}

export async function todoCreateList(
  userId: string,
  input: { name: string; themeColor?: string | null; backgroundImage?: string | null },
) {
  const name = cleanListName(input.name);
  if (!name) throw new TodoMcpError("invalid", "List name cannot be empty.");
  await ensureDefaultList(userId);
  const maximum = await prisma.list.aggregate({ where: { ownerId: userId }, _max: { sortOrder: true } });
  const list = await prisma.list.create({
    data: {
      ownerId: userId,
      kind: "CUSTOM",
      name,
      themeColor: input.themeColor,
      backgroundImage: input.backgroundImage,
      sortOrder: Math.min((maximum._max.sortOrder ?? -1) + 1, MAX_TODO_SORT_ORDER),
    },
    include: listInclude,
  });
  return serializeList(list, userId);
}

export async function todoUpdateList(
  userId: string,
  input: { id: string; expectedUpdatedAt: string; name?: string; themeColor?: string | null; backgroundImage?: string | null },
) {
  const expected = expectedDate(input.expectedUpdatedAt);
  const data: { name?: string; themeColor?: string | null; backgroundImage?: string | null } = {};
  if (typeof input.name === "string") {
    data.name = cleanListName(input.name);
    if (!data.name) throw new TodoMcpError("invalid", "List name cannot be empty.");
  }
  if (input.themeColor === null || typeof input.themeColor === "string") data.themeColor = input.themeColor;
  if (input.backgroundImage === null || typeof input.backgroundImage === "string") data.backgroundImage = input.backgroundImage;
  if (!Object.keys(data).length) throw new TodoMcpError("invalid", "Provide at least one list field to update.");
  const result = await prisma.list.updateMany({ where: { id: input.id, updatedAt: expected, AND: editableListWhere(userId) }, data });
  if (!result.count) {
    const current = await prisma.list.findFirst({ where: { id: input.id, AND: editableListWhere(userId) }, select: { updatedAt: true } });
    if (!current) throw new TodoMcpError("not_found", "List unavailable.");
    throw new TodoMcpError("conflict", "The list changed after it was read.", { currentUpdatedAt: current.updatedAt.toISOString() });
  }
  const list = await prisma.list.findFirst({ where: { id: input.id, AND: readableListWhere(userId) }, include: listInclude });
  if (!list) throw new TodoMcpError("not_found", "List unavailable.");
  return serializeList(list, userId);
}

export async function todoDeleteList(
  userId: string,
  input: { id: string; expectedUpdatedAt: string; expectedTaskCount: number; expectedSubtaskCount: number },
) {
  const expected = expectedDate(input.expectedUpdatedAt);
  return prisma.$transaction(async (tx) => {
    const list = await tx.list.findFirst({
      where: { id: input.id, ownerId: userId, kind: "CUSTOM" },
      select: { updatedAt: true, _count: { select: { tasks: true } } },
    });
    if (!list) return { id: input.id, deleted: false, alreadyAbsent: true, deletedTaskCount: 0, deletedSubtaskCount: 0 };
    if (list.updatedAt.getTime() !== expected.getTime()) {
      throw new TodoMcpError("conflict", "The list changed after it was read.", { currentUpdatedAt: list.updatedAt.toISOString() });
    }
    if (list._count.tasks !== input.expectedTaskCount) {
      throw new TodoMcpError("conflict", "The list's task count changed after it was read.", { currentTaskCount: list._count.tasks });
    }
    const currentSubtaskCount = await tx.subtask.count({ where: { task: { listId: input.id } } });
    if (currentSubtaskCount !== input.expectedSubtaskCount) {
      throw new TodoMcpError("conflict", "The list's subtask count changed after it was read.", { currentSubtaskCount });
    }
    const deleted = await tx.list.deleteMany({ where: { id: input.id, ownerId: userId, kind: "CUSTOM", updatedAt: expected } });
    if (!deleted.count) throw new TodoMcpError("conflict", "The list changed while it was being deleted.");
    return { id: input.id, deleted: true, alreadyAbsent: false, deletedTaskCount: list._count.tasks, deletedSubtaskCount: currentSubtaskCount };
  }, { isolationLevel: "Serializable" });
}

export async function todoListTasks(
  userId: string,
  input: {
    query?: string;
    listId?: string;
    isCompleted?: boolean;
    isImportant?: boolean;
    isMyDay?: boolean;
    dueFrom?: string;
    dueTo?: string;
    limit?: number;
    cursor?: string;
  } = {},
) {
  const limit = pageSize(input.limit);
  const offset = parseCursor(input.cursor);
  const query = input.query?.trim();
  const dueFrom = input.dueFrom ? optionalDate(input.dueFrom) : undefined;
  const dueTo = input.dueTo ? optionalDate(input.dueTo) : undefined;
  if (input.listId) {
    const list = await prisma.list.findFirst({ where: { id: input.listId, AND: readableListWhere(userId) }, select: { id: true } });
    if (!list) throw new TodoMcpError("not_found", "List unavailable.");
  }
  const constraints: Prisma.TaskWhereInput[] = [readableTaskWhere(userId)];
  if (typeof input.isImportant === "boolean") constraints.push(personalFilter(userId, "isImportant", input.isImportant));
  if (typeof input.isMyDay === "boolean") constraints.push(personalFilter(userId, "isMyDay", input.isMyDay));
  if (query) constraints.push({ OR: [
    { title: { contains: query, mode: "insensitive" } },
    { notes: { contains: query, mode: "insensitive" } },
    { subtasks: { some: { title: { contains: query, mode: "insensitive" } } } },
  ] });
  const tasks = await prisma.task.findMany({
    where: {
      AND: constraints,
      ...(input.listId ? { listId: input.listId } : {}),
      ...(typeof input.isCompleted === "boolean" ? { isCompleted: input.isCompleted } : {}),
      ...(dueFrom || dueTo ? { dueDate: { ...(dueFrom ? { gte: dueFrom } : {}), ...(dueTo ? { lte: dueTo } : {}) } } : {}),
    },
    include: taskInclude(userId),
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    skip: offset,
    take: limit + 1,
  });
  const page = tasks.slice(0, limit);
  return { items: page.map((task) => serializeTask(task, userId)), nextCursor: nextCursor(offset, tasks.length > limit, limit) };
}

export async function todoGetTask(userId: string, id: string) {
  const task = await prisma.task.findFirst({ where: { id, AND: readableTaskWhere(userId) }, include: taskInclude(userId) });
  if (!task) throw new TodoMcpError("not_found", "Task unavailable.");
  return serializeTask(task, userId);
}

export async function todoCreateTask(
  userId: string,
  input: {
    title: string;
    listId?: string;
    notes?: string | null;
    dueDate?: string | null;
    isCompleted?: boolean;
    isImportant?: boolean;
    isMyDay?: boolean;
  },
) {
  const title = cleanTaskTitle(input.title);
  if (!title) throw new TodoMcpError("invalid", "Task title cannot be empty.");
  const targetListId = input.listId ?? (await ensureDefaultList(userId)).id;
  const task = await prisma.$transaction(async (tx) => {
    const target = await tx.list.findFirst({ where: { id: targetListId, AND: editableListWhere(userId) }, select: { id: true } });
    if (!target) throw new TodoMcpError("not_found", "List unavailable.");
    const maximum = await tx.task.aggregate({ where: { listId: target.id }, _max: { sortOrder: true } });
    const created = await tx.task.create({
      data: {
        createdById: userId,
        listId: target.id,
        title,
        notes: typeof input.notes === "string" ? cleanTaskNotes(input.notes) : input.notes,
        dueDate: optionalDate(input.dueDate),
        isCompleted: input.isCompleted ?? false,
        isImportant: input.isImportant ?? false,
        isMyDay: input.isMyDay ?? false,
        sortOrder: Math.min((maximum._max?.sortOrder ?? -1) + 1, MAX_TODO_SORT_ORDER),
        personalStates: { create: { userId, isImportant: input.isImportant ?? false, isMyDay: input.isMyDay ?? false } },
      },
      include: taskInclude(userId),
    });
    await tx.list.update({ where: { id: target.id }, data: { updatedAt: new Date() } });
    return created;
  });
  return serializeTask(task, userId);
}

export async function todoUpdateTask(
  userId: string,
  input: {
    id: string;
    expectedUpdatedAt: string;
    title?: string;
    notes?: string | null;
    dueDate?: string | null;
    isCompleted?: boolean;
    isImportant?: boolean;
    isMyDay?: boolean;
    listId?: string;
  },
) {
  const expected = expectedDate(input.expectedUpdatedAt);
  const content: Prisma.TaskUpdateInput = {};
  if (typeof input.title === "string") {
    const title = cleanTaskTitle(input.title);
    if (!title) throw new TodoMcpError("invalid", "Task title cannot be empty.");
    content.title = title;
  }
  if (input.notes === null || typeof input.notes === "string") content.notes = typeof input.notes === "string" ? cleanTaskNotes(input.notes) : null;
  if (input.dueDate === null || typeof input.dueDate === "string") content.dueDate = optionalDate(input.dueDate);
  if (typeof input.isCompleted === "boolean") content.isCompleted = input.isCompleted;
  const personal: { isImportant?: boolean; isMyDay?: boolean } = {};
  if (typeof input.isImportant === "boolean") personal.isImportant = input.isImportant;
  if (typeof input.isMyDay === "boolean") personal.isMyDay = input.isMyDay;
  if (!Object.keys(content).length && !Object.keys(personal).length && typeof input.listId !== "string") {
    throw new TodoMcpError("invalid", "Provide at least one task field to update.");
  }

  await prisma.$transaction(async (tx) => {
    const current = await tx.task.findFirst({
      where: { id: input.id, AND: editableTaskWhere(userId) },
      select: { id: true, listId: true, createdById: true, updatedAt: true },
    });
    if (!current) throw new TodoMcpError("not_found", "Task unavailable.");
    if (current.updatedAt.getTime() !== expected.getTime()) {
      throw new TodoMcpError("conflict", "The task changed after it was read.", { currentUpdatedAt: current.updatedAt.toISOString() });
    }
    let targetListId = current.listId;
    if (typeof input.listId === "string") {
      const target = await tx.list.findFirst({ where: { id: input.listId, AND: editableListWhere(userId) }, select: { id: true } });
      if (!target) throw new TodoMcpError("not_found", "Target list unavailable.");
      targetListId = target.id;
      content.list = { connect: { id: target.id } };
    }
    if (current.createdById === userId) Object.assign(content, personal);
    await tx.task.update({ where: { id: current.id }, data: { ...content, updatedAt: new Date() } });
    if (Object.keys(personal).length) {
      await tx.taskPersonalState.upsert({
        where: { taskId_userId: { taskId: current.id, userId } },
        create: { taskId: current.id, userId, ...personal },
        update: personal,
      });
    }
    await tx.list.updateMany({ where: { id: { in: [current.listId, targetListId] } }, data: { updatedAt: new Date() } });
  });
  return todoGetTask(userId, input.id);
}

export async function todoDeleteTask(
  userId: string,
  input: { id: string; expectedUpdatedAt: string; expectedSubtaskCount: number },
) {
  const expected = expectedDate(input.expectedUpdatedAt);
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: input.id, AND: editableTaskWhere(userId) },
      select: { listId: true, updatedAt: true, _count: { select: { subtasks: true } } },
    });
    if (!task) return { id: input.id, deleted: false, alreadyAbsent: true, deletedSubtaskCount: 0 };
    if (task.updatedAt.getTime() !== expected.getTime()) {
      throw new TodoMcpError("conflict", "The task changed after it was read.", { currentUpdatedAt: task.updatedAt.toISOString() });
    }
    if (task._count.subtasks !== input.expectedSubtaskCount) {
      throw new TodoMcpError("conflict", "The task's subtask count changed after it was read.", { currentSubtaskCount: task._count.subtasks });
    }
    const deleted = await moveTaskToTrash(tx, userId, input.id, expected);
    if (!deleted) throw new TodoMcpError("conflict", "The task changed while it was being deleted.");
    await tx.list.update({ where: { id: task.listId }, data: { updatedAt: new Date() } });
    return { id: input.id, deleted: true, alreadyAbsent: false, deletedSubtaskCount: task._count.subtasks };
  }, { isolationLevel: "Serializable" });
}

export async function todoCreateSubtask(userId: string, input: { taskId: string; title: string; isCompleted?: boolean }) {
  const title = cleanSubtaskTitle(input.title);
  if (!title) throw new TodoMcpError("invalid", "Subtask title cannot be empty.");
  const subtask = await prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({ where: { id: input.taskId, AND: editableTaskWhere(userId) }, select: { id: true, listId: true } });
    if (!task) throw new TodoMcpError("not_found", "Task unavailable.");
    const maximum = await tx.subtask.aggregate({ where: { taskId: task.id }, _max: { sortOrder: true } });
    const created = await tx.subtask.create({
      data: { taskId: task.id, title, isCompleted: input.isCompleted ?? false, sortOrder: Math.min((maximum._max?.sortOrder ?? -1) + 1, MAX_TODO_SORT_ORDER) },
    });
    await tx.task.update({ where: { id: task.id }, data: { updatedAt: new Date() } });
    await tx.list.update({ where: { id: task.listId }, data: { updatedAt: new Date() } });
    return created;
  });
  return serializeSubtask(subtask);
}

export async function todoUpdateSubtask(
  userId: string,
  input: { id: string; expectedUpdatedAt: string; title?: string; isCompleted?: boolean },
) {
  const expected = expectedDate(input.expectedUpdatedAt);
  const data: { title?: string; isCompleted?: boolean } = {};
  if (typeof input.title === "string") {
    data.title = cleanSubtaskTitle(input.title);
    if (!data.title) throw new TodoMcpError("invalid", "Subtask title cannot be empty.");
  }
  if (typeof input.isCompleted === "boolean") data.isCompleted = input.isCompleted;
  if (!Object.keys(data).length) throw new TodoMcpError("invalid", "Provide at least one subtask field to update.");
  await prisma.$transaction(async (tx) => {
    const current = await tx.subtask.findFirst({
      where: { id: input.id, AND: editableSubtaskWhere(userId) },
      select: { id: true, taskId: true, updatedAt: true, task: { select: { listId: true } } },
    });
    if (!current) throw new TodoMcpError("not_found", "Subtask unavailable.");
    if (current.updatedAt.getTime() !== expected.getTime()) {
      throw new TodoMcpError("conflict", "The subtask changed after it was read.", { currentUpdatedAt: current.updatedAt.toISOString() });
    }
    await tx.subtask.update({ where: { id: current.id }, data });
    await tx.task.update({ where: { id: current.taskId }, data: { updatedAt: new Date() } });
    await tx.list.update({ where: { id: current.task.listId }, data: { updatedAt: new Date() } });
  });
  const subtask = await prisma.subtask.findFirst({ where: { id: input.id, AND: readableSubtaskWhere(userId) } });
  if (!subtask) throw new TodoMcpError("not_found", "Subtask unavailable.");
  return serializeSubtask(subtask);
}

export async function todoDeleteSubtask(userId: string, input: { id: string; expectedUpdatedAt: string }) {
  const expected = expectedDate(input.expectedUpdatedAt);
  return prisma.$transaction(async (tx) => {
    const current = await tx.subtask.findFirst({
      where: { id: input.id, AND: editableSubtaskWhere(userId) },
      select: { id: true, taskId: true, updatedAt: true, task: { select: { listId: true } } },
    });
    if (!current) return { id: input.id, deleted: false, alreadyAbsent: true };
    if (current.updatedAt.getTime() !== expected.getTime()) {
      throw new TodoMcpError("conflict", "The subtask changed after it was read.", { currentUpdatedAt: current.updatedAt.toISOString() });
    }
    await tx.subtask.delete({ where: { id: current.id } });
    await tx.task.update({ where: { id: current.taskId }, data: { updatedAt: new Date() } });
    await tx.list.update({ where: { id: current.task.listId }, data: { updatedAt: new Date() } });
    return { id: input.id, deleted: true, alreadyAbsent: false };
  });
}
