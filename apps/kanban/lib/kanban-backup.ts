import { kanbanImportedBoardSchema } from "./kanban-operations-schema.ts";
import type { Board } from "./kanban-data.ts";

export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const BACKUP_FORMAT = "openkanban";
const BACKUP_VERSION = 2;

export type KanbanBackupPayload = {
  activeBoardId: string | null;
  boards: Board[];
};

type KanbanBackupDocument = {
  format: typeof BACKUP_FORMAT;
  version: 1 | typeof BACKUP_VERSION;
  exportedAt: string;
  activeBoardId: string;
  boards: unknown[];
};

export function createKanbanBackup(boards: unknown[], activeBoardId: string, exportedAt = new Date()): string {
  const backup: KanbanBackupDocument = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    activeBoardId,
    boards,
  };

  const text = JSON.stringify(backup, null, 2);
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES || boards.some((board) => new TextEncoder().encode(JSON.stringify(board)).byteLength > 2 * 1024 * 1024 - 8192)) {
    throw new Error("This backup exceeds the supported size limit (10 MiB per file, 2 MiB per board). Export a smaller board selection or use a full database backup.");
  }
  return text;
}

export function parseKanbanBackup(text: string): KanbanBackupPayload | null {
  try {
    if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) return null;
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object") return null;

    const candidate = value as Partial<KanbanBackupDocument>;
    if (candidate.format !== BACKUP_FORMAT || ![1, BACKUP_VERSION].includes(candidate.version as number) || !Array.isArray(candidate.boards)) {
      return null;
    }

    // Version 1 never carried archived cards. Reject disguised data rather than silently dropping it.
    if (candidate.version === 1 && candidate.boards.some((board) => board && typeof board === "object" && "archivedTasks" in board)) return null;
    const parsed = kanbanImportedBoardSchema.array().min(1).safeParse(candidate.boards);
    if (!parsed.success || new Set(parsed.data.map((board) => board.id)).size !== parsed.data.length) return null;
    // Leave room for the bounded import operation envelope and generated IDs.
    if (parsed.data.some((board) => new TextEncoder().encode(JSON.stringify(board)).byteLength > 2 * 1024 * 1024 - 8192)) return null;
    return {
      activeBoardId: typeof candidate.activeBoardId === "string" ? candidate.activeBoardId : null,
      boards: parsed.data,
    };
  } catch {
    return null;
  }
}
