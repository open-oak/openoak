export const NOTE_PAGE_SIZE = 40;
export const MAX_NOTE_SEARCH_LENGTH = 200;

export const NOTE_METADATA_SELECT = {
  id: true,
  title: true,
  color: true,
  sortOrder: true,
  folderId: true,
  folder: { select: { name: true } },
  createdAt: true,
  updatedAt: true,
} as const;

// Two sidebars can briefly coexist while the mobile sheet is open. Keeping one
// 40-row page in each leaves a conservative margin below PERF-001's 1,500-node
// contract, including the editor and dialog shells.
export const NOTE_ROW_DOM_NODE_BUDGET = 12;
export const NOTES_APP_STATIC_DOM_NODE_BUDGET = 400;
export const MAX_NOTES_APP_DOM_NODES =
  NOTE_PAGE_SIZE * 2 * NOTE_ROW_DOM_NODE_BUDGET + NOTES_APP_STATIC_DOM_NODE_BUDGET;

export function normalizeNoteQuery(query: string | undefined) {
  return query?.trim().slice(0, MAX_NOTE_SEARCH_LENGTH) ?? "";
}
export function encodeNoteCursor(offset: number) {
  return Buffer.from(String(Math.max(0, Math.floor(offset))), "utf8").toString("base64url");
}

export function decodeNoteCursor(cursor: string | undefined) {
  if (!cursor) return 0;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!/^\d{1,7}$/.test(decoded)) return 0;
    const offset = Number(decoded);
    return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  } catch {
    return 0;
  }
}

export function fixturePage<T>(items: T[], cursor?: string) {
  const offset = decodeNoteCursor(cursor);
  const page = items.slice(offset, offset + NOTE_PAGE_SIZE);
  return {
    items: page,
    totalCount: items.length,
    nextCursor:
      offset + page.length < items.length ? encodeNoteCursor(offset + page.length) : null,
  };
}
