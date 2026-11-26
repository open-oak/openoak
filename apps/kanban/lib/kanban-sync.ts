import { cleanBoards, type Board, type BoardAppearance } from "./kanban-data.ts";

export type SyncDocument = {
  boards: Board[];
  activeBoardId: string;
  revision: number;
  updatedAt: string;
};

export function cleanSyncDocument(value: unknown, appearanceFallback?: BoardAppearance): SyncDocument | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SyncDocument>;
  const boards = cleanBoards(candidate.boards, appearanceFallback);
  if (
    boards.length === 0 ||
    typeof candidate.activeBoardId !== "string" ||
    typeof candidate.revision !== "number" ||
    !Number.isInteger(candidate.revision) ||
    candidate.revision < 1
  ) {
    return null;
  }

  return {
    boards,
    activeBoardId: boards.some((board) => board.id === candidate.activeBoardId)
      ? candidate.activeBoardId
      : boards[0].id,
    revision: candidate.revision,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : "",
  };
}
