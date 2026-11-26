export function folderMoveRemainsVisible(
  query: string,
  selectedFolderId: string | null | undefined,
  targetFolderId: string | null,
) {
  return query.trim().length > 0
    || selectedFolderId === undefined
    || selectedFolderId === targetFolderId;
}
