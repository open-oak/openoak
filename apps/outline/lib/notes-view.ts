import type { NoteItem } from "./types.ts";
import { plainTextFromStoredNoteBody } from "./note-markdown.ts";

/**
 * Pure note-list logic shared by the client components: naming, search,
 * ordering, and how a server response is merged back into local state. Kept
 * out of the components so the ordering and merge rules can be tested without
 * a DOM or a database.
 */

export type SavePatch = Partial<{
  title: NoteItem["title"];
  body: Exclude<NoteItem["body"], null>;
  color: NoteItem["color"];
}>;
export type SaveState = "saved" | "saving" | "error";

export function plainTextFromNoteBody(body: string) {
  return plainTextFromStoredNoteBody(body);
}

export function statisticTextFromNoteBody(body: string) {
  return plainTextFromNoteBody(body).replace(/^[☐☑]\s?/gm, "");
}

/** Notes created optimistically carry a temporary id until the server answers. */
export function isTempNote(id: string) {
  return id.startsWith("temp-");
}

export function displayTitle(note: Pick<NoteItem, "title">) {
  return note.title.trim() || "Untitled note";
}

export function excerptFromNoteBody(body: string) {
  const excerpt = plainTextFromNoteBody(body).trim().replace(/\s+/g, " ");
  if (!excerpt) return "";
  return excerpt.length > 88 ? `${excerpt.slice(0, 88)}...` : excerpt;
}

export function noteExcerpt(note: NoteItem) {
  const excerpt = note.body === null ? note.excerpt : excerptFromNoteBody(note.body);
  return excerpt || "No note text yet";
}

export function wordCount(body: string) {
  const words = statisticTextFromNoteBody(body).trim().match(/\S+/g);
  return words?.length ?? 0;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

/** Explicit order first, creation time as the tie-break. */
export function sortNotes(notes: NoteItem[]) {
  return [...notes].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

export function filterNotes(notes: NoteItem[], query: string) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return notes;
  return notes.filter((note) => (
    note.title.toLowerCase().includes(trimmed) ||
    (note.body !== null && plainTextFromNoteBody(note.body).toLowerCase().includes(trimmed))
  ));
}

/** Renumbers sortOrder to match array position. */
export function withSequentialOrder(notes: NoteItem[]) {
  return notes.map((note, sortOrder) => (note.sortOrder === sortOrder ? note : { ...note, sortOrder }));
}

/**
 * Applies a server note over the local one, but only for fields the user has
 * not edited since the save was sent. Without this check a slow response would
 * overwrite keystrokes typed while it was in flight.
 */
export function mergeServerNote(local: NoteItem, server: NoteItem, patch: SavePatch): NoteItem {
  return {
    ...local,
    title: patch.title !== undefined && local.title === patch.title ? server.title : local.title,
    body: patch.body !== undefined && local.body === patch.body ? server.body : local.body,
    excerpt: patch.body !== undefined && local.body === patch.body ? server.excerpt : local.excerpt,
    color: patch.color !== undefined && local.color === patch.color ? server.color : local.color,
    sortOrder: server.sortOrder,
    updatedAt: server.updatedAt,
  };
}

function reorder(notes: NoteItem[], fromIndex: number, toIndex: number) {
  const ordered = [...notes];
  const [moved] = ordered.splice(fromIndex, 1);
  ordered.splice(toIndex, 0, moved);
  return withSequentialOrder(ordered);
}

/** Keyboard/button move: -1 up, 1 down. Returns the same array at the ends. */
export function moveNoteByOffset(notes: NoteItem[], id: string, direction: -1 | 1) {
  const index = notes.findIndex((note) => note.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= notes.length) return notes;
  return reorder(notes, index, target);
}

/**
 * Moves a note past its neighbour *in the visible list*, then applies that to
 * the full list. While a search filter is active the sidebar shows a subset, so
 * moving against full-list positions would swap a note past something the user
 * cannot see and look like nothing happened.
 *
 * `visible` is the filtered list in display order; pass the full list when no
 * filter is active.
 */
export function moveNoteAmongVisible(notes: NoteItem[], visible: NoteItem[], id: string, direction: -1 | 1) {
  const visibleIndex = visible.findIndex((note) => note.id === id);
  const neighbour = visible[visibleIndex + direction];
  if (visibleIndex < 0 || !neighbour) return notes;
  return moveNoteToTarget(notes, id, neighbour.id);
}

/**
 * Which edge of `targetId` a drop would land on, for the insertion line shown
 * while dragging. Dropping places the dragged note at the target's position, so
 * a note dragged downwards ends up after the target and one dragged upwards
 * ends up before it.
 */
export function dropEdgeFor(notes: NoteItem[], draggedId: string, targetId: string): "before" | "after" | null {
  if (draggedId === targetId) return null;
  const from = notes.findIndex((note) => note.id === draggedId);
  const to = notes.findIndex((note) => note.id === targetId);
  if (from < 0 || to < 0) return null;
  return from < to ? "after" : "before";
}

/** Drag and drop: place the dragged note where the target note sits. */
export function moveNoteToTarget(notes: NoteItem[], draggedId: string, targetId: string) {
  if (draggedId === targetId) return notes;
  const from = notes.findIndex((note) => note.id === draggedId);
  const to = notes.findIndex((note) => note.id === targetId);
  if (from < 0 || to < 0) return notes;
  return reorder(notes, from, to);
}
