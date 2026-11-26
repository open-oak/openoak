import { kanbanOperationSchema, type KanbanOperation } from "./kanban-operations-schema.ts";

const QUEUE_VERSION = 1;
const MAX_QUEUE_ITEMS = 500;

export function offlineQueueKey(accountKey: string) {
  return `open-kanban-offline-operations:${accountKey}`;
}

export type QueuedKanbanOperation = {
  queueVersion: 1;
  queuedAt: string;
  attempts: number;
  state: "pending" | "blocked";
  lastError?: string;
  operation: KanbanOperation;
};

export type QueueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function operationKey(item: QueuedKanbanOperation) {
  return `${item.operation.epoch}:${item.operation.boardKey}:${item.operation.operationId}`;
}

function isQueued(value: unknown): value is QueuedKanbanOperation {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<QueuedKanbanOperation>;
  return item.queueVersion === QUEUE_VERSION && typeof item.queuedAt === "string" &&
    typeof item.attempts === "number" && (item.state === "pending" || item.state === "blocked") &&
    kanbanOperationSchema.safeParse(item.operation).success;
}

export function readOfflineQueue(storage: QueueStorage | null, key: string): QueuedKanbanOperation[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) || "[]");
    if (!Array.isArray(parsed) || !parsed.every(isQueued)) throw new Error("Invalid saved queue. Export recovery data before resetting it.");
    return parsed;
  } catch { throw new Error("Unable to read saved operations. Keep the original recovery data."); }
}

export function writeOfflineQueue(storage: QueueStorage | null, key: string, queue: QueuedKanbanOperation[]) {
  if (!storage) return false;
  try {
    if (queue.length > MAX_QUEUE_ITEMS) return false;
    storage.setItem(key, JSON.stringify(queue));
    return true;
  } catch { return false; }
}

/** Add an operation exactly once. The operation ID is the retry/idempotency key. */
export function enqueueOfflineOperation(storage: QueueStorage | null, key: string, operation: KanbanOperation, queuedAt = new Date().toISOString()) {
  const queue = readOfflineQueue(storage, key);
  const item: QueuedKanbanOperation = { queueVersion: 1, queuedAt, attempts: 0, state: "pending", operation };
  if (queue.some((entry) => operationKey(entry) === operationKey(item))) return queue;
  const next = [...queue, item];
  if (!writeOfflineQueue(storage, key, next)) throw new Error("Unable to save this edit on the device. Export a backup or free storage first.");
  return next;
}

export function markOfflineOperation(storage: QueueStorage | null, key: string, operationId: string, result: { status: "applied" | "duplicate" | "no_op" } | { status: "conflict" | "error"; message: string }) {
  const queue = readOfflineQueue(storage, key);
  const next = "message" in result
    ? queue.map((entry) => entry.operation.operationId === operationId
      ? { ...entry, state: result.status === "conflict" ? "blocked" as const : "pending" as const, attempts: entry.attempts + 1, lastError: result.message }
      : entry)
    : queue.filter((entry) => entry.operation.operationId !== operationId);
  writeOfflineQueue(storage, key, next);
  return next;
}

/** Coalesce adjacent field edits while preserving creates, moves, and deletes. */
export function compactOfflineQueue(queue: QueuedKanbanOperation[]) {
  const compacted: QueuedKanbanOperation[] = [];
  for (const item of queue) {
    const operation = item.operation;
    const previous = compacted.at(-1);
    if (previous?.attempts === 0 && item.attempts === 0 && previous.state === "pending" && item.state === "pending" && previous.operation.type === "card.update" && operation.type === "card.update" &&
      previous.operation.boardKey === operation.boardKey && previous.operation.cardId === operation.cardId &&
      previous.operation.epoch === operation.epoch) {
      compacted[compacted.length - 1] = {
        ...item,
        queuedAt: previous.queuedAt,
        attempts: Math.max(previous.attempts, item.attempts),
        operation: { ...operation, expectedContentVersion: previous.operation.expectedContentVersion, changes: { ...previous.operation.changes, ...operation.changes } },
      };
    } else compacted.push(item);
  }
  return compacted;
}

export function exportOfflineQueue(queue: QueuedKanbanOperation[]) {
  return JSON.stringify({ format: "openoak-kanban-offline-queue", version: QUEUE_VERSION, operations: queue }, null, 2);
}

/** Replay in order after reconnect; stop at the first conflict to preserve intent. */
export async function drainOfflineQueue(
  storage: QueueStorage | null,
  key: string,
  send: (operation: KanbanOperation) => Promise<{ status: "applied" | "duplicate" | "no_op" }>
) {
  const compacted = readOfflineQueue(storage, key);
  for (const item of compacted) {
    if (item.state === "blocked") break;
    try {
      const current = readOfflineQueue(storage, key).map((entry) => entry.operation.operationId === item.operation.operationId ? { ...entry, attempts: entry.attempts + 1 } : entry);
      if (!writeOfflineQueue(storage, key, current)) throw new Error("Unable to persist retry state");
      await send(item.operation);
      markOfflineOperation(storage, key, item.operation.operationId, { status: "applied" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      markOfflineOperation(storage, key, item.operation.operationId, { status: message.includes("conflict") ? "conflict" : "error", message });
      break;
    }
  }
  return readOfflineQueue(storage, key);
}
