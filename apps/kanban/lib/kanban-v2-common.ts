import { createHash } from "node:crypto";

export const KANBAN_RESULT_BYTES = 65_000; // Room for the outer JSON-RPC envelope.
export const KANBAN_V2_SUMMARY = "OpenKanban v2 result.";
export type KanbanErrorCode = "invalid" | "not_found" | "conflict" | "operation_id_reused" | "too_large" | "restart_read" | "upgrade_required";

export class KanbanError extends Error {
  readonly code: KanbanErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: KanbanErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export function v2Envelope(value: unknown) {
  return { content: [{ type: "text", text: KANBAN_V2_SUMMARY }], structuredContent: value };
}

export function fitsV2Result(value: unknown) {
  return Buffer.byteLength(JSON.stringify(v2Envelope(value))) <= KANBAN_RESULT_BYTES;
}

export function boundedV2Result<T>(value: T): T {
  if (!fitsV2Result(value)) throw new KanbanError("too_large", "The result cannot fit in one response. Use detail pages or detail chunks.");
  return value;
}

export function readLimit(limit = 20) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new KanbanError("invalid", "limit must be an integer from 1 to 50.");
  return limit;
}

export function scopeDigest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export type ReadCursor = { v: 2; scope: string; stamp: string; after: (string | number)[] };
export function encodeReadCursor(scope: string, stamp: string, after: (string | number)[]) {
  return Buffer.from(JSON.stringify({ v: 2, scope, stamp, after })).toString("base64url");
}

export function decodeReadCursor(token: string | undefined, scope: string, stamp: string): ReadCursor | null {
  if (!token) return null;
  try {
    if (token.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error();
    const value = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (value.v !== 2 || value.scope !== scope || typeof value.stamp !== "string" || !Array.isArray(value.after)
      || !value.after.every((part: unknown) => typeof part === "string" || (typeof part === "number" && Number.isSafeInteger(part) && part >= 0))) throw new Error();
    if (value.stamp !== stamp) throw new KanbanError("restart_read", "The records changed. Restart this read from its first page.");
    return value;
  } catch (error) {
    if (error instanceof KanbanError) throw error;
    throw new KanbanError("invalid", "Invalid cursor or cursor used with a different account, filter or projection.");
  }
}

export function kanbanBoardUrl(id: string, cardId?: string) {
  const base = (process.env.KANBAN_PUBLIC_URL || "https://kanban.openoak.org").replace(/\/$/, "");
  return `${base}/?board=${encodeURIComponent(id)}${cardId !== undefined ? `&card=${encodeURIComponent(cardId)}` : ""}`;
}
