export const MAX_NOTE_TITLE_LENGTH = 160;
export const MAX_NOTE_BODY_LENGTH = 80_000;
export const MAX_NOTE_SORT_ORDER = 2_147_483_647;

export function cleanNoteTitle(title: string) {
  const trimmed = title.trim().slice(0, MAX_NOTE_TITLE_LENGTH);
  return trimmed || "Untitled note";
}

export function cleanNoteBody(body: string) {
  return body.slice(0, MAX_NOTE_BODY_LENGTH);
}
