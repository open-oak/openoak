import type { Prisma } from "@/generated/prisma/client";
import {
  TASK_PAGE_SIZE,
  type SortDirection,
  type SortOption,
  type TaskPageScope,
} from "@/lib/types";
import { personalFlagWhere, readableTaskWhere } from "@/lib/todo-access";

export const MAX_TASK_PAGE_SIZE = 100;

export function shouldShowTaskEmptyState(serverActiveTotal: number, visibleActiveCount: number) {
  return serverActiveTotal === 0 && visibleActiveCount === 0;
}

export function normalizeTaskPageSize(limit?: number) {
  if (!Number.isFinite(limit)) return TASK_PAGE_SIZE;
  return Math.min(MAX_TASK_PAGE_SIZE, Math.max(1, Math.trunc(limit!)));
}

export function normalizeTaskSort(sort: unknown, direction: unknown) {
  const normalizedSort: SortOption =
    sort === "alpha" || sort === "importance" || sort === "created" || sort === "due" || sort === "custom"
      ? sort
      : "created";
  const normalizedDirection: SortDirection = direction === "asc" || direction === "desc" ? direction : "desc";
  return { sort: normalizedSort, direction: normalizedDirection };
}

export function encodeTaskCursor(id: string) {
  return Buffer.from(JSON.stringify({ version: 1, id }), "utf8").toString("base64url");
}

export function decodeTaskCursor(cursor?: string | null) {
  if (!cursor) return null;
  if (cursor.length > 1_024) throw new Error("Invalid task cursor");

  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      version?: unknown;
      id?: unknown;
    };
    if (value.version !== 1 || typeof value.id !== "string" || !value.id) {
      throw new Error("Invalid task cursor");
    }
    return value.id;
  } catch {
    throw new Error("Invalid task cursor");
  }
}

export function buildTaskPageWhere(
  userId: string,
  scope: TaskPageScope,
  completed: boolean,
  defaultListId?: string,
): Prisma.TaskWhereInput {
  const viewWhere: Prisma.TaskWhereInput =
    scope.kind === "my-day"
      ? personalFlagWhere(userId, "isMyDay")
      : scope.kind === "important"
        ? personalFlagWhere(userId, "isImportant")
        : scope.kind === "planned"
          ? { dueDate: { not: null } }
          : scope.kind === "list"
            ? { listId: scope.listId }
            : { listId: defaultListId ?? "__missing_default_list__" };

  return {
    ...readableTaskWhere(userId),
    title: { not: "" },
    isCompleted: completed,
    ...viewWhere,
  };
}

export function buildTaskPageOrderBy(
  sort: SortOption,
  direction: SortDirection,
  completed: boolean,
): Prisma.TaskOrderByWithRelationInput[] {
  if (completed || sort === "custom") {
    return [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }];
  }

  switch (sort) {
    case "alpha":
      return [{ title: direction }, { id: direction }];
    case "importance":
      return [
        { isImportant: direction },
        { sortOrder: "asc" },
        { createdAt: "asc" },
        { id: "asc" },
      ];
    case "due":
      return [
        { dueDate: { sort: direction, nulls: "last" } },
        { createdAt: "asc" },
        { id: "asc" },
      ];
    case "created":
    default:
      return [{ createdAt: direction }, { id: direction }];
  }
}
