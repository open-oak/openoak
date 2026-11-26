import type { ListItem, SidebarCounts, Task, TaskPageResult, TaskPageScope, SortDirection, SortOption } from "@/lib/types";

export interface TodoSyncRequest {
  scope: TaskPageScope;
  sort: SortOption;
  direction: SortDirection;
  activeCursor: string | null;
  completedCursor: string | null;
}

export interface TodoSyncSnapshot {
  lists: ListItem[];
  counts: SidebarCounts;
  defaultListId: string;
  active: TaskPageResult<Task>;
  completed: TaskPageResult<Task>;
  syncedAt: string;
}

export interface PendingTaskMutation {
  kind: "create" | "update" | "delete";
  version: number;
  dirtyFields: string[];
  snapshot: Task | null;
  remoteDeleteDeferred?: boolean;
}

export function todoSyncRequestKey(request: TodoSyncRequest) {
  const scope = request.scope.kind === "list" ? `list:${request.scope.listId}` : request.scope.kind;
  return [scope, request.sort, request.direction, request.activeCursor || "", request.completedCursor || ""].join("|");
}

export function todoSyncSearchParams(request: TodoSyncRequest) {
  const params = new URLSearchParams({
    scope: request.scope.kind,
    sort: request.sort,
    direction: request.direction,
  });
  if (request.scope.kind === "list") params.set("listId", request.scope.listId);
  if (request.activeCursor) params.set("activeCursor", request.activeCursor);
  if (request.completedCursor) params.set("completedCursor", request.completedCursor);
  return params;
}

export function normalizeSyncTask(task: Task): Task {
  return {
    ...task,
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt),
    dueDate: task.dueDate ? new Date(task.dueDate) : null,
  };
}

export function normalizeSyncList(list: ListItem): ListItem {
  return { ...list, createdAt: new Date(list.createdAt), updatedAt: new Date(list.updatedAt) };
}

function overlayDirtyFields(remote: Task, local: Task, fields: readonly string[]) {
  const merged = { ...remote } as Task & Record<string, unknown>;
  const localRecord = local as Task & Record<string, unknown>;
  for (const field of fields) merged[field] = localRecord[field];
  return merged as Task;
}

export function reconcileVisibleTasks(
  current: Map<string, Task>,
  remoteTasks: Task[],
  pending: Record<string, PendingTaskMutation>,
) {
  const next = new Map<string, Task>();
  const normalizedRemote = remoteTasks.map(normalizeSyncTask);
  const remoteIds = new Set(normalizedRemote.map((task) => task.id));
  const deferredDeleteIds: string[] = [];

  for (const remote of normalizedRemote) {
    const mutation = pending[remote.id];
    if (mutation?.kind === "delete") continue;
    const local = current.get(remote.id);
    next.set(
      remote.id,
      mutation?.kind === "update" && local
        ? overlayDirtyFields(remote, local, mutation.dirtyFields)
        : remote,
    );
  }

  for (const [id, local] of current) {
    const mutation = pending[id];
    if (mutation?.kind === "create") {
      next.set(id, local);
    } else if (mutation?.kind === "update" && !remoteIds.has(id)) {
      next.set(id, local);
      deferredDeleteIds.push(id);
    }
  }

  return { tasks: next, deferredDeleteIds };
}
