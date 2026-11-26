"use server";

import { cache } from "react";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { moveTaskToTrash, restoreTrashedTask } from "@/lib/task-recovery";
import {
  MAX_LIST_NAME_LENGTH,
  MAX_SUBTASK_TITLE_LENGTH,
  MAX_TASK_NOTES_LENGTH,
  MAX_TODO_SORT_ORDER,
  MAX_TASK_TITLE_LENGTH,
} from "@/lib/todo-validation";
import { ensureTodoProfile } from "@/lib/auth";
import {
  editableListWhere,
  editableSubtaskWhere,
  editableTaskWhere,
  personalFlagWhere,
  projectPersonalTaskFlags,
  readableTaskWhere,
} from "@/lib/todo-access";
import {
  buildTaskPageOrderBy,
  buildTaskPageWhere,
  decodeTaskCursor,
  encodeTaskCursor,
  normalizeTaskPageSize,
  normalizeTaskSort,
} from "@/lib/task-pagination";
import type {
  Task,
  TaskPageRequest,
  TaskPageResult,
  TaskViewRequest,
  TaskViewResult,
} from "@/lib/types";
import { revalidatePath } from "next/cache";

function revalidateTaskViews() {
  revalidatePath("/", "page");
  revalidatePath("/important", "page");
  revalidatePath("/planned", "page");
  revalidatePath("/tasks", "page");
  revalidatePath("/lists/[listId]", "page");
}

function revalidateAppLayout() {
  revalidatePath("/", "layout");
}

export async function ensureUser() {
  return ensureTodoProfile();
}

function taskPersonalState(userId: string) {
  return {
    personalStates: {
      where: { userId },
      select: { isImportant: true, isMyDay: true },
      take: 1,
    },
  } as const;
}

async function setPersonalFlags(
  userId: string,
  taskId: string,
  flags: { isImportant?: boolean; isMyDay?: boolean },
) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: taskId, ...editableTaskWhere(userId) },
      select: { id: true, listId: true, createdById: true },
    });
    if (!task) return false;

    await tx.taskPersonalState.upsert({
      where: { taskId_userId: { taskId, userId } },
      create: { taskId, userId, ...flags },
      update: flags,
    });
    if (task.createdById === userId) {
      await tx.task.update({ where: { id: taskId }, data: flags });
    }
    await tx.list.update({ where: { id: task.listId }, data: { updatedAt: new Date() } });
    return true;
  });
}

async function setBulkPersonalFlag(
  userId: string,
  taskIds: string[],
  flag: "isImportant" | "isMyDay",
  value: boolean,
) {
  return prisma.$transaction(async (tx) => {
    const tasks = await tx.task.findMany({
      where: { id: { in: taskIds }, ...editableTaskWhere(userId) },
      select: { id: true, listId: true, createdById: true },
    });
    if (tasks.length !== taskIds.length) throw new Error("One or more tasks are unavailable");
    for (const task of tasks) {
      await tx.taskPersonalState.upsert({
        where: { taskId_userId: { taskId: task.id, userId } },
        create: { taskId: task.id, userId, [flag]: value },
        update: { [flag]: value },
      });
    }
    await tx.task.updateMany({
      where: { id: { in: tasks.filter((task) => task.createdById === userId).map((task) => task.id) } },
      data: { [flag]: value },
    });
    await tx.list.updateMany({
      where: { id: { in: Array.from(new Set(tasks.map((task) => task.listId))) } },
      data: { updatedAt: new Date() },
    });
  });
}

async function updateBulkTaskContent(
  userId: string,
  taskIds: string[],
  data: Prisma.TaskUpdateManyMutationInput,
) {
  return prisma.$transaction(async (tx) => {
    const tasks = await tx.task.findMany({
      where: { id: { in: taskIds }, ...editableTaskWhere(userId) },
      select: { id: true, listId: true },
    });
    if (tasks.length !== taskIds.length) throw new Error("One or more tasks are unavailable");
    await tx.task.updateMany({ where: { id: { in: taskIds } }, data });
    await tx.list.updateMany({
      where: { id: { in: Array.from(new Set(tasks.map((task) => task.listId))) } },
      data: { updatedAt: new Date() },
    });
  });
}

async function updateTaskContent(
  userId: string,
  taskId: string,
  data: Prisma.TaskUpdateManyMutationInput,
) {
  return prisma.$transaction(async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: taskId, ...editableTaskWhere(userId) },
      select: { id: true, listId: true },
    });
    if (!task) return false;
    await tx.task.update({ where: { id: task.id }, data });
    await tx.list.update({ where: { id: task.listId }, data: { updatedAt: new Date() } });
    return true;
  });
}

async function updateSubtaskContent(
  userId: string,
  subtaskId: string,
  data: Prisma.SubtaskUpdateManyMutationInput,
) {
  return prisma.$transaction(async (tx) => {
    const subtask = await tx.subtask.findFirst({
      where: { id: subtaskId, ...editableSubtaskWhere(userId) },
      select: { id: true, taskId: true, task: { select: { listId: true } } },
    });
    if (!subtask) return false;
    await tx.subtask.update({ where: { id: subtask.id }, data });
    await tx.task.update({ where: { id: subtask.taskId }, data: { updatedAt: new Date() } });
    await tx.list.update({ where: { id: subtask.task.listId }, data: { updatedAt: new Date() } });
    return true;
  });
}

async function cleanupGhostTasks(userId: string) {
  const oneMinuteAgo = new Date(Date.now() - 60_000);
  await prisma.task.deleteMany({
    where: {
      ...editableTaskWhere(userId),
      title: "",
      isCompleted: false,
      OR: [{ notes: null }, { notes: "" }],
      subtasks: { none: {} },
      updatedAt: { lt: oneMinuteAgo },
    },
  });
}

async function resolveEditableListId(userId: string, listId?: string | null) {
  if (!listId) return getDefaultListId();

  const list = await prisma.list.findFirst({
    where: { id: listId, ...editableListWhere(userId) },
    select: { id: true },
  });

  return list?.id ?? null;
}

export async function addTask(formData: FormData) {
  const rawTitle = formData.get("title") as string;
  const title = (rawTitle?.trim() || "").slice(0, MAX_TASK_TITLE_LENGTH);
  const isImportant = formData.get("isImportant") === "true";
  const isMyDay = formData.get("isMyDay") === "true";
  const listId = formData.get("listId") as string;
  const dueDateStr = formData.get("dueDate") as string | null;

  if (!title) return;

  const user = await ensureUser();

  const targetListId = await resolveEditableListId(user.id, listId);
  if (!targetListId) return;

  try {
    const createdTask = await prisma.$transaction(async (tx) => {
      const target = await tx.list.findFirst({
        where: { id: targetListId, ...editableListWhere(user.id) },
        select: { id: true },
      });
      if (!target) return null;
      const maxSort = await tx.task.aggregate({
        where: { listId: target.id, title: { not: "" } },
        _max: { sortOrder: true },
      });
      const task = await tx.task.create({
        data: {
          title,
          createdById: user.id,
          listId: target.id,
          isImportant,
          isMyDay,
          sortOrder: Math.min((maxSort._max?.sortOrder ?? -1) + 1, MAX_TODO_SORT_ORDER),
          personalStates: { create: { userId: user.id, isImportant, isMyDay } },
          ...(dueDateStr ? { dueDate: new Date(dueDateStr) } : {}),
        },
        include: { subtasks: { select: { id: true, title: true, isCompleted: true } } },
      });
      await tx.list.update({ where: { id: target.id }, data: { updatedAt: new Date() } });
      return task;
    });
    if (!createdTask) return;
    revalidateTaskViews();
    return createdTask;
  } catch (error) {
    console.error("addTask failed:", error);
    revalidateTaskViews();
    return { error: "Failed to add task" };
  }
}

export async function toggleTask(taskId: string, completed: boolean) {
  const user = await ensureUser();
  try {
    if (!(await updateTaskContent(user.id, taskId, { isCompleted: completed }))) return;
  } catch (error) {
    console.error("toggleTask failed:", error);
    revalidateTaskViews();
    return { error: "Failed to update task" };
  }
  revalidateTaskViews();
}

export async function toggleImportant(taskId: string, important: boolean) {
  const user = await ensureUser();
  try {
    if (!(await setPersonalFlags(user.id, taskId, { isImportant: important }))) return;
  } catch (error) {
    console.error("toggleImportant failed:", error);
    revalidateTaskViews();
    return { error: "Failed to update task" };
  }
  revalidateTaskViews();
}

export async function updateTask(taskId: string, data: { title?: string; notes?: string; isCompleted?: boolean }) {
  const user = await ensureUser();
  const updateData: Prisma.TaskUpdateManyMutationInput = {};
  if (typeof data?.title === "string") updateData.title = data.title.trim().slice(0, MAX_TASK_TITLE_LENGTH);
  if (typeof data?.notes === "string") updateData.notes = data.notes.slice(0, MAX_TASK_NOTES_LENGTH);
  if (typeof data?.isCompleted === "boolean") updateData.isCompleted = data.isCompleted;
  if (Object.keys(updateData).length === 0) return;

  try {
    if (!(await updateTaskContent(user.id, taskId, updateData))) return;
    revalidateTaskViews();
  } catch (error) {
    console.error("updateTask failed:", error);
    revalidateTaskViews();
    return { error: "Failed to update task" };
  }
}

export async function deleteTask(taskId: string) {
  const user = await ensureUser();
  try {
    await prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id: taskId, ...editableTaskWhere(user.id) },
        select: { id: true, listId: true },
      });
      if (!task) return;
      await moveTaskToTrash(tx, user.id, task.id);
      await tx.list.update({ where: { id: task.listId }, data: { updatedAt: new Date() } });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    console.error("deleteTask failed:", error);
    return { error: "Failed to delete task" };
  }
  revalidateTaskViews();
}

export async function discardBlankTask(taskId: string) {
  const user = await ensureUser();
  try {
    const discarded = await prisma.$transaction(async (tx) => {
      const task = await tx.task.findFirst({
        where: { id: taskId, title: "", ...editableTaskWhere(user.id) },
        select: { id: true, listId: true },
      });
      if (!task) return false;

      const deleted = await tx.task.deleteMany({
        where: { id: task.id, title: "", ...editableTaskWhere(user.id) },
      });
      if (deleted.count === 0) return false;

      await tx.list.update({ where: { id: task.listId }, data: { updatedAt: new Date() } });
      return true;
    });
    if (discarded) revalidateTaskViews();
    return { discarded };
  } catch (error) {
    console.error("discardBlankTask failed:", error);
    revalidateTaskViews();
    return { error: "Failed to discard blank task" };
  }
}

export async function addSubtask(taskId: string, title: string) {
  const trimmedTitle = title.trim().slice(0, MAX_SUBTASK_TITLE_LENGTH);
  if (!trimmedTitle) return;
  const user = await ensureUser();
  try {
    const subtask = await prisma.$transaction(async (tx) => {
      const parentTask = await tx.task.findFirst({
        where: { id: taskId, ...editableTaskWhere(user.id) },
        select: { id: true, listId: true },
      });
      if (!parentTask) return null;
      const created = await tx.subtask.create({ data: { title: trimmedTitle, taskId } });
      await tx.task.update({ where: { id: parentTask.id }, data: { updatedAt: new Date() } });
      await tx.list.update({ where: { id: parentTask.listId }, data: { updatedAt: new Date() } });
      return created;
    });
    if (!subtask) return;
    revalidateTaskViews();
    return subtask;
  } catch (error) {
    console.error("addSubtask failed:", error);
    revalidateTaskViews();
    return { error: "Failed to add step" };
  }
}

export async function toggleSubtask(subtaskId: string, completed: boolean) {
  const user = await ensureUser();
  try {
    if (!(await updateSubtaskContent(user.id, subtaskId, { isCompleted: completed }))) return;
  } catch (error) {
    console.error("toggleSubtask failed:", error);
    revalidateTaskViews();
    return { error: "Failed to update step" };
  }
  revalidateTaskViews();
}

export async function updateSubtask(subtaskId: string, title: string) {
  const trimmed = title.trim().slice(0, MAX_SUBTASK_TITLE_LENGTH);
  if (!trimmed) return;
  const user = await ensureUser();
  try {
    if (!(await updateSubtaskContent(user.id, subtaskId, { title: trimmed }))) return;
  } catch (error) {
    console.error("updateSubtask failed:", error);
    revalidateTaskViews();
    return { error: "Failed to update step" };
  }
  revalidateTaskViews();
}

export async function deleteSubtask(subtaskId: string) {
  const user = await ensureUser();
  try {
    await prisma.$transaction(async (tx) => {
      const subtask = await tx.subtask.findFirst({
        where: { id: subtaskId, ...editableSubtaskWhere(user.id) },
        select: { id: true, taskId: true, task: { select: { listId: true } } },
      });
      if (!subtask) return;
      await tx.subtask.delete({ where: { id: subtask.id } });
      await tx.task.update({ where: { id: subtask.taskId }, data: { updatedAt: new Date() } });
      await tx.list.update({ where: { id: subtask.task.listId }, data: { updatedAt: new Date() } });
    });
  } catch (error) {
    console.error("deleteSubtask failed:", error);
    revalidateTaskViews();
    return { error: "Failed to delete step" };
  }
  revalidateTaskViews();
}

export async function getTask(taskId: string) {
  const user = await ensureUser();
  const task = await prisma.task.findFirst({
    where: { id: taskId, ...readableTaskWhere(user.id) },
    select: {
      id: true,
      title: true,
      notes: true,
      isCompleted: true,
      isImportant: true,
      isMyDay: true,
      listId: true,
      dueDate: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
      createdById: true,
      ...taskPersonalState(user.id),
      subtasks: {
        select: { id: true, title: true, isCompleted: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  return task ? projectPersonalTaskFlags(task, user.id) : null;
}

export async function createList(name: string) {
  const trimmedName = name.trim().slice(0, MAX_LIST_NAME_LENGTH);
  if (!trimmedName) return null;
  const user = await ensureUser();
  try {
    const list = await prisma.list.create({
      data: {
        name: trimmedName,
        ownerId: user.id,
        kind: "CUSTOM",
      },
    });
    revalidateAppLayout();
    return {
      ...list,
      accessLevel: "owner" as const,
      ownerDisplay: "You",
      shared: false,
      memberCount: 0,
      section: "owned" as const,
    };
  } catch (error) {
    console.error("createList failed:", error);
    return null;
  }
}

export async function updateList(listId: string, name: string) {
  const trimmedName = name.trim().slice(0, MAX_LIST_NAME_LENGTH);
  if (!trimmedName) return;
  const user = await ensureUser();
  try {
    await prisma.list.update({
      where: { id: listId, AND: editableListWhere(user.id) },
      data: { name: trimmedName },
    });
  } catch (error) {
    console.error("updateList failed:", error);
    revalidateAppLayout();
    return { error: "Failed to rename list" };
  }
  revalidateAppLayout();
}

export async function getLists() {
  const user = await ensureUser();
  const listSelect = {
    id: true,
    name: true,
    themeColor: true,
    backgroundImage: true,
    sortOrder: true,
    ownerId: true,
    kind: true,
    createdAt: true,
    updatedAt: true,
    owner: { select: { displayName: true, email: true } },
    _count: { select: { members: true } },
  } as const;
  const [owned, joined] = await Promise.all([
    prisma.list.findMany({ where: { ownerId: user.id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: listSelect }),
    prisma.list.findMany({ where: { kind: "CUSTOM", members: { some: { userId: user.id } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: listSelect }),
  ]);
  return [...owned.map((list) => ({ list, section: "owned" as const })), ...joined.map((list) => ({ list, section: "joined" as const }))]
    .map(({ list, section }) => ({
      id: list.id,
      name: list.name,
      themeColor: list.themeColor,
      backgroundImage: list.backgroundImage,
      sortOrder: list.sortOrder,
      ownerId: list.ownerId,
      kind: list.kind,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
      accessLevel: section === "owned" ? "owner" as const : "editor" as const,
      ownerDisplay: section === "owned" ? "You" : list.owner.displayName || list.owner.email || "Shared list owner",
      shared: list._count.members > 0,
      memberCount: list._count.members,
      section,
    }));
}

export async function updateTheme(color: string, listId?: string, smartListType?: "my-day" | "important" | "planned" | "tasks") {
  const user = await ensureUser();
  try {
    if (listId) {
      await prisma.list.update({
        where: { id: listId, AND: editableListWhere(user.id) },
        data: { themeColor: color },
      });
    } else if (smartListType) {
      const fieldMap = {
        "my-day": "myDayTheme",
        "important": "importantTheme",
        "planned": "plannedTheme",
        "tasks": "tasksTheme",
      };
      const field = fieldMap[smartListType];
      await prisma.todoProfile.update({
        where: { id: user.id },
        data: { [field]: color },
      });
    } else {
      await prisma.todoProfile.update({
        where: { id: user.id },
        data: { themeColor: color },
      });
    }
  } catch (error) {
    console.error("updateTheme failed:", error);
  }
  revalidateAppLayout();
}

export async function deleteList(listId: string) {
  const user = await ensureUser();
  try {
    await prisma.$transaction(async (tx) => {
      const listCount = await tx.list.count({ where: { ownerId: user.id } });
      if (listCount <= 1) {
        throw new Error("Cannot delete your only list");
      }
      await tx.list.delete({
        where: { id: listId, ownerId: user.id, kind: "CUSTOM" },
      });
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "deleteList failed";
    console.error("deleteList failed:", error);
    return { error: msg };
  }
  revalidateAppLayout();
}

export async function setDueDate(taskId: string, date: Date | null) {
  const user = await ensureUser();
  try {
    if (!(await updateTaskContent(user.id, taskId, { dueDate: date }))) return;
  } catch (error) {
    console.error("setDueDate failed:", error);
    revalidateTaskViews();
    return { error: "Failed to set due date" };
  }
  revalidateTaskViews();
}

export async function toggleMyDay(taskId: string, isMyDay: boolean) {
  const user = await ensureUser();
  try {
    if (!(await setPersonalFlags(user.id, taskId, { isMyDay }))) return;
  } catch (error) {
    console.error("toggleMyDay failed:", error);
    revalidateTaskViews();
    return { error: "Failed to update task" };
  }
  revalidateTaskViews();
}

export async function updateBackground(bg: string, listId?: string, smartListType?: "my-day" | "important" | "planned" | "tasks") {
  const user = await ensureUser();
  try {
    if (listId) {
      await prisma.list.update({
        where: { id: listId, AND: editableListWhere(user.id) },
        data: { backgroundImage: bg || null },
      });
    } else if (smartListType) {
      const fieldMap = {
        "my-day": "myDayBg",
        "important": "importantBg",
        "planned": "plannedBg",
        "tasks": "tasksBg",
      };
      const field = fieldMap[smartListType];
      await prisma.todoProfile.update({
        where: { id: user.id },
        data: { [field]: bg || null },
      });
    }
  } catch (error) {
    console.error("updateBackground failed:", error);
  }
  revalidateAppLayout();
}

async function getDefaultListIdForUser(userId: string) {
  const defaultList = await prisma.list.findFirst({
    where: { ownerId: userId, kind: "DEFAULT" },
    select: { id: true },
  });
  if (defaultList) return defaultList.id;

  const created = await prisma.list.create({
    data: { name: "Tasks", ownerId: userId, kind: "DEFAULT" },
    select: { id: true },
  });
  return created.id;
}

export const getDefaultListId = cache(async () => {
  const user = await ensureUser();
  return getDefaultListIdForUser(user.id);
});

async function loadTaskPage(
  userId: string,
  input: TaskPageRequest,
  defaultListId?: string,
): Promise<TaskPageResult<Task>> {
  const pageSize = normalizeTaskPageSize(input.limit);
  const cursorId = decodeTaskCursor(input.cursor);
  const { sort, direction } = normalizeTaskSort(input.sort, input.direction);
  const completed = input.completed === true;
  const where = buildTaskPageWhere(userId, input.scope, completed, defaultListId);
  const orderBy = buildTaskPageOrderBy(sort, direction, completed);

  const [totalCount, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      include: {
        subtasks: {
          select: { id: true, title: true, isCompleted: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        },
        list: { select: { name: true } },
        ...taskPersonalState(userId),
      },
      orderBy,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      take: pageSize + 1,
    }),
  ]);
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const items = page.map((task) => projectPersonalTaskFlags(task, userId));

  return {
    items,
    totalCount,
    nextCursor: hasMore ? encodeTaskCursor(items.at(-1)!.id) : null,
  };
}

export async function getTaskPage(input: TaskPageRequest): Promise<TaskPageResult<Task>> {
  const user = await ensureUser();
  const defaultListId = input.scope.kind === "tasks" ? await getDefaultListIdForUser(user.id) : undefined;
  return loadTaskPage(user.id, input, defaultListId);
}

export async function getTaskView(input: TaskViewRequest): Promise<TaskViewResult<Task>> {
  const user = await ensureUser();
  const defaultListId = input.scope.kind === "tasks" ? await getDefaultListIdForUser(user.id) : undefined;
  const common = {
    scope: input.scope,
    sort: input.sort,
    direction: input.direction,
    limit: input.limit,
  };
  const [active, completed] = await Promise.all([
    loadTaskPage(user.id, { ...common, completed: false, cursor: input.activeCursor }, defaultListId),
    loadTaskPage(user.id, { ...common, completed: true, cursor: input.completedCursor }, defaultListId),
  ]);
  return { active, completed };
}

export async function searchTasks(
  query: string,
  scope: "all" | "today" | "upcoming" | "important" = "all",
  limit = 20,
  cursor?: string | null,
) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery && scope === "all") {
    return { items: [], totalCount: 0, nextCursor: null };
  }
  const user = await ensureUser();
  const pageSize = normalizeTaskPageSize(limit);
  const cursorId = decodeTaskCursor(cursor);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  const scopeWhere =
    scope === "important"
      ? personalFlagWhere(user.id, "isImportant")
      : scope === "today"
        ? { dueDate: { gte: todayStart, lt: tomorrowStart } }
        : scope === "upcoming"
          ? { dueDate: { gte: tomorrowStart } }
          : {};

  const where: Prisma.TaskWhereInput = {
    ...readableTaskWhere(user.id),
    title: { not: "" },
    ...scopeWhere,
    ...(normalizedQuery
      ? {
          OR: [
            { title: { contains: normalizedQuery, mode: "insensitive" as const } },
            { notes: { contains: normalizedQuery, mode: "insensitive" as const } },
            { subtasks: { some: { title: { contains: normalizedQuery, mode: "insensitive" as const } } } },
          ],
        }
      : {}),
  };
  const orderBy: Prisma.TaskOrderByWithRelationInput[] =
    scope === "today" || scope === "upcoming"
      ? [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }]
      : [{ createdAt: "desc" }, { id: "desc" }];

  const [totalCount, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      take: pageSize + 1,
      select: {
        id: true,
        title: true,
        isCompleted: true,
        isImportant: true,
        isMyDay: true,
        createdById: true,
        ...taskPersonalState(user.id),
      },
    }),
  ]);
  const hasMore = rows.length > pageSize;
  const page = hasMore ? rows.slice(0, pageSize) : rows;
  const items = page.map((task) => projectPersonalTaskFlags(task, user.id));

  return {
    items,
    totalCount,
    nextCursor: hasMore ? encodeTaskCursor(items.at(-1)!.id) : null,
  };
}

export async function moveTaskToList(taskId: string, listId: string) {
  const user = await ensureUser();
  try {
    const moved = await prisma.$transaction(async (tx) => {
      const [task, targetList] = await Promise.all([
        tx.task.findFirst({ where: { id: taskId, ...editableTaskWhere(user.id) }, select: { id: true, listId: true } }),
        tx.list.findFirst({ where: { id: listId, ...editableListWhere(user.id) }, select: { id: true } }),
      ]);
      if (!task || !targetList) return false;
      await tx.task.update({ where: { id: task.id }, data: { listId: targetList.id } });
      await tx.list.updateMany({ where: { id: { in: [task.listId, targetList.id] } }, data: { updatedAt: new Date() } });
      return true;
    });
    if (!moved) return;
  } catch (error) {
    console.error("moveTaskToList failed:", error);
    revalidateTaskViews();
    return { error: "Failed to move task" };
  }
  revalidateTaskViews();
}

function normalizeTaskIds(taskIds: string[]) {
  return Array.from(new Set(taskIds.filter(Boolean)));
}

export async function bulkAddTasksToMyDay(taskIds: string[]) {
  const user = await ensureUser();
  const ids = normalizeTaskIds(taskIds);
  if (ids.length === 0) return;

  try {
    await setBulkPersonalFlag(user.id, ids, "isMyDay", true);
  } catch (error) {
    console.error("bulkAddTasksToMyDay failed:", error);
    revalidateTaskViews();
    return { error: "Failed to update tasks" };
  }
  revalidateTaskViews();
}

export async function bulkRemoveTasksFromMyDay(taskIds: string[]) {
  const user = await ensureUser();
  const ids = normalizeTaskIds(taskIds);
  if (ids.length === 0) return;

  try {
    await setBulkPersonalFlag(user.id, ids, "isMyDay", false);
  } catch (error) {
    console.error("bulkRemoveTasksFromMyDay failed:", error);
    revalidateTaskViews();
    return { error: "Failed to update tasks" };
  }
  revalidateTaskViews();
}

export async function bulkCompleteTasks(taskIds: string[]) {
  const user = await ensureUser();
  const ids = normalizeTaskIds(taskIds);
  if (ids.length === 0) return;

  try {
    await updateBulkTaskContent(user.id, ids, { isCompleted: true });
  } catch (error) {
    console.error("bulkCompleteTasks failed:", error);
    revalidateTaskViews();
    return { error: "Failed to update tasks" };
  }
  revalidateTaskViews();
}

export async function bulkUncompleteTasks(taskIds: string[]) {
  const user = await ensureUser();
  const ids = normalizeTaskIds(taskIds);
  if (ids.length === 0) return;

  try {
    await updateBulkTaskContent(user.id, ids, { isCompleted: false });
  } catch (error) {
    console.error("bulkUncompleteTasks failed:", error);
    revalidateTaskViews();
    return { error: "Failed to update tasks" };
  }
  revalidateTaskViews();
}

export async function bulkMarkTasksImportant(taskIds: string[]) {
  const user = await ensureUser();
  const ids = normalizeTaskIds(taskIds);
  if (ids.length === 0) return;

  try {
    await setBulkPersonalFlag(user.id, ids, "isImportant", true);
  } catch (error) {
    console.error("bulkMarkTasksImportant failed:", error);
    revalidateTaskViews();
    return { error: "Failed to update tasks" };
  }
  revalidateTaskViews();
}

export async function bulkUnmarkTasksImportant(taskIds: string[]) {
  const user = await ensureUser();
  const ids = normalizeTaskIds(taskIds);
  if (ids.length === 0) return;

  try {
    await setBulkPersonalFlag(user.id, ids, "isImportant", false);
  } catch (error) {
    console.error("bulkUnmarkTasksImportant failed:", error);
    revalidateTaskViews();
    return { error: "Failed to update tasks" };
  }
  revalidateTaskViews();
}

export async function bulkMoveTasksToList(taskIds: string[], listId: string) {
  const user = await ensureUser();
  const ids = normalizeTaskIds(taskIds);
  if (ids.length === 0) return;

  try {
    await prisma.$transaction(async (tx) => {
      const [targetList, tasks] = await Promise.all([
        tx.list.findFirst({ where: { id: listId, ...editableListWhere(user.id) }, select: { id: true } }),
        tx.task.findMany({ where: { id: { in: ids }, ...editableTaskWhere(user.id) }, select: { id: true, listId: true } }),
      ]);
      if (!targetList || tasks.length !== ids.length) throw new Error("One or more tasks are unavailable");
      await tx.task.updateMany({ where: { id: { in: ids } }, data: { listId } });
      await tx.list.updateMany({
        where: { id: { in: Array.from(new Set([...tasks.map((task) => task.listId), listId])) } },
        data: { updatedAt: new Date() },
      });
    });
  } catch (error) {
    console.error("bulkMoveTasksToList failed:", error);
    revalidateTaskViews();
    return { error: "Failed to move tasks" };
  }
  revalidateTaskViews();
}

export async function bulkCopyTasksToList(taskIds: string[], listId: string) {
  const user = await ensureUser();
  const ids = normalizeTaskIds(taskIds).slice(0, 50);
  if (ids.length === 0) return;

  try {
    await prisma.$transaction(async (tx) => {
      const targetList = await tx.list.findFirst({
        where: { id: listId, ...editableListWhere(user.id) },
        select: { id: true },
      });
      if (!targetList) throw new Error("Target list is unavailable");

      const tasksToCopy = await tx.task.findMany({
        where: { id: { in: ids }, title: { not: "" }, ...readableTaskWhere(user.id) },
        include: {
          subtasks: { select: { title: true, isCompleted: true, sortOrder: true } },
          ...taskPersonalState(user.id),
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      });
      if (tasksToCopy.length !== ids.length) throw new Error("One or more tasks are unavailable");

      const maxSort = await tx.task.aggregate({
        where: { listId, title: { not: "" } },
        _max: { sortOrder: true },
      });
      const baseSortOrder = maxSort._max?.sortOrder ?? -1;

      for (const [index, sourceTask] of tasksToCopy.entries()) {
        const task = projectPersonalTaskFlags(sourceTask, user.id);
        await tx.task.create({
          data: {
            title: task.title,
            notes: task.notes,
            isCompleted: task.isCompleted,
            isImportant: task.isImportant,
            isMyDay: task.isMyDay,
            dueDate: task.dueDate,
            listId,
            createdById: user.id,
            sortOrder: Math.min(baseSortOrder + index + 1, MAX_TODO_SORT_ORDER),
            personalStates: {
              create: { userId: user.id, isImportant: task.isImportant, isMyDay: task.isMyDay },
            },
            subtasks: task.subtasks.length
              ? {
                  createMany: {
                    data: task.subtasks.map((subtask) => ({
                      title: subtask.title,
                      isCompleted: subtask.isCompleted,
                      sortOrder: subtask.sortOrder,
                    })),
                  },
                }
              : undefined,
          },
        });
      }
      await tx.list.update({ where: { id: listId }, data: { updatedAt: new Date() } });
    });
  } catch (error) {
    console.error("bulkCopyTasksToList failed:", error);
    revalidateTaskViews();
    return { error: "Failed to copy tasks" };
  }
  revalidateTaskViews();
}

export async function bulkDeleteTasks(taskIds: string[]) {
  const user = await ensureUser();
  const ids = normalizeTaskIds(taskIds);
  if (ids.length === 0) return;

  try {
    await prisma.$transaction(async (tx) => {
      const tasks = await tx.task.findMany({
        where: { id: { in: ids }, ...editableTaskWhere(user.id) },
        select: { id: true, listId: true },
      });
      if (tasks.length !== ids.length) throw new Error("One or more tasks are unavailable");
      for (const task of tasks) await moveTaskToTrash(tx, user.id, task.id);
      await tx.list.updateMany({
        where: { id: { in: Array.from(new Set(tasks.map((task) => task.listId))) } },
        data: { updatedAt: new Date() },
      });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    console.error("bulkDeleteTasks failed:", error);
    revalidateTaskViews();
    return { error: "Failed to delete tasks" };
  }
  revalidateTaskViews();
}

export async function reorderTasks(taskIds: string[]) {
  const user = await ensureUser();
  if (taskIds.length === 0) return;
  try {
    await prisma.$transaction(async (tx) => {
      const tasks = await tx.task.findMany({
        where: { id: { in: taskIds }, ...editableTaskWhere(user.id) },
        select: { id: true, listId: true },
      });
      if (tasks.length !== new Set(taskIds).size) throw new Error("One or more tasks are unavailable");
      for (const [index, id] of taskIds.entries()) {
        await tx.task.updateMany({
          where: { id },
          data: { sortOrder: index },
        });
      }
      await tx.list.updateMany({
        where: { id: { in: Array.from(new Set(tasks.map((task) => task.listId))) } },
        data: { updatedAt: new Date() },
      });
    });
  } catch (error) {
    console.error("reorderTasks failed:", error);
    revalidateTaskViews();
    return { error: "Failed to reorder tasks" };
  }
  revalidateTaskViews();
}

export async function createBlankTask(listId: string, isMyDay?: boolean, isImportant?: boolean, isPlanned?: boolean) {
  const user = await ensureUser();
  const [targetListId] = await Promise.all([
    resolveEditableListId(user.id, listId),
    cleanupGhostTasks(user.id),
  ]);
  if (!targetListId) return;

  let dueDate: Date | undefined;
  if (isPlanned) {
    dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 1);
    dueDate.setHours(13, 0, 0, 0);
  }

  const task = await prisma.$transaction(async (tx) => {
    const target = await tx.list.findFirst({
      where: { id: targetListId, ...editableListWhere(user.id) },
      select: { id: true },
    });
    if (!target) return null;
    const created = await tx.task.create({
      data: {
        title: "",
        createdById: user.id,
        listId: target.id,
        isMyDay: isMyDay || false,
        isImportant: isImportant || false,
        sortOrder: 2147483647,
        personalStates: {
          create: { userId: user.id, isMyDay: isMyDay || false, isImportant: isImportant || false },
        },
        ...(dueDate ? { dueDate } : {}),
      },
    });
    await tx.list.update({ where: { id: target.id }, data: { updatedAt: new Date() } });
    return created;
  });

  return task?.id;
}

export async function getSidebarData() {
  const user = await ensureUser();
  const visible = { title: { not: "" }, ...readableTaskWhere(user.id) } satisfies Prisma.TaskWhereInput;
  const incomplete = { ...visible, isCompleted: false } satisfies Prisma.TaskWhereInput;
  // One parallel batch. The default list's count comes from the grouped counts,
  // so no query waits for the default list id.
  const [lists, defaultListId, myDay, important, importantAny, planned, plannedAny, groupedListCounts] = await Promise.all([
    getLists(),
    getDefaultListId(),
    prisma.task.count({ where: { ...incomplete, ...personalFlagWhere(user.id, "isMyDay") } }),
    prisma.task.count({ where: { ...incomplete, ...personalFlagWhere(user.id, "isImportant") } }),
    prisma.task.count({ where: { ...visible, ...personalFlagWhere(user.id, "isImportant") } }),
    prisma.task.count({ where: { ...incomplete, dueDate: { not: null } } }),
    prisma.task.count({ where: { ...visible, dueDate: { not: null } } }),
    prisma.task.groupBy({
      by: ["listId"],
      where: incomplete,
      _count: { _all: true },
    }),
  ]);

  const listCounts = Object.fromEntries(lists.map((list) => [list.id, 0]));
  for (const group of groupedListCounts) listCounts[group.listId] = group._count._all;
  const all = listCounts[defaultListId] ?? 0;

  return {
    lists,
    counts: {
      myDay,
      important,
      importantAny,
      planned,
      plannedAny,
      all,
      lists: listCounts,
    },
    defaultListId,
  };
}

export async function reorderLists(listIds: string[]) {
  const user = await ensureUser();
  if (listIds.length === 0) return;
  try {
    await prisma.$transaction(
      listIds.map((id, index) =>
        prisma.list.updateMany({
          where: { id, ownerId: user.id },
          data: { sortOrder: index },
        })
      )
    );
  } catch (error) {
    console.error("reorderLists failed:", error);
    revalidateAppLayout();
    return { error: "Failed to reorder lists" };
  }
  revalidateAppLayout();
}

export async function getUserSettings() {
  const user = await ensureUser();
  return user;
}

export async function loadDeletedTasks(cursor?: string) {
  const user = await ensureUser();
  const rows = await prisma.taskTrash.findMany({
    where: { list: editableListWhere(user.id) },
    orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
    take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, title: true, deletedAt: true, list: { select: { name: true, ownerId: true } } },
  });
  return { items: rows.slice(0, 50).map((row) => ({ id: row.id, title: row.title || "Untitled task", detail: row.list.name, deletedAt: row.deletedAt.toISOString(), canPurge: row.list.ownerId === user.id })), nextCursor: rows.length > 50 ? rows[49].id : null };
}

export async function restoreDeletedTask(trashId: string) {
  const user = await ensureUser();
  try {
    await prisma.$transaction((tx) => restoreTrashedTask(tx, user.id, trashId), { isolationLevel: "Serializable" });
    revalidateTaskViews();
    return {};
  } catch { return { error: "Could not restore this task. Check your access and try again." }; }
}

export async function purgeDeletedTask(trashId: string) {
  const user = await ensureUser();
  const result = await prisma.taskTrash.deleteMany({ where: { id: trashId, list: { ownerId: user.id } } });
  if (!result.count) return { error: "Only the list owner can permanently delete a task." };
  return {};
}
