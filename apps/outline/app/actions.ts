"use server";

import { unstable_rethrow } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { moveNoteToTrash, restoreTrashedNote } from "@/lib/note-recovery";
import {
  ensureNotesProfile,
  getNoteExcerpts,
  getNotesPageForProfile,
  isAccentColor,
  isColorMode,
  isWallpaperId,
  serializeNote,
  serializeFolder,
  serializeNoteSummary,
  serializeSettings,
} from "@/lib/notes-data";
import { cleanFolderName, folderNameKey } from "@/lib/folder-validation";
import { NOTE_METADATA_SELECT, NOTE_PAGE_SIZE } from "@/lib/note-pagination";
import { cleanNoteBody, cleanNoteTitle, MAX_NOTE_SORT_ORDER } from "@/lib/note-validation";
import { storedNoteBodyToMarkdown } from "@/lib/note-markdown-server";
import { RICH_TEXT_PREFIX } from "@/lib/note-markdown";
import type {
  AccentColor,
  ActionResult,
  ColorMode,
  FolderItem,
  NoteItem,
  NotesPage,
  NotesSettings,
  WallpaperId,
} from "@/lib/types";

// These actions return the updated records and the client reconciles them
// directly. Revalidating `/` here can replace the optimistic editor while a
// temporary note id is being swapped for its database id.

export async function loadNotesPage(input: {
  cursor?: string;
  query?: string;
  folderId?: string | null;
}): Promise<ActionResult<NotesPage>> {
  try {
    const { profile } = await ensureNotesProfile();
    return { ok: true, data: await getNotesPageForProfile(profile.id, input) };
  } catch (error) {
    unstable_rethrow(error);
    console.error("loadNotesPage failed:", error);
    return { ok: false, error: "Could not load notes." };
  }
}

export async function getNote(noteId: string): Promise<ActionResult<NoteItem>> {
  try {
    const { profile } = await ensureNotesProfile();
    const note = await prisma.note.findFirst({
      where: { id: noteId, ownerId: profile.id },
      include: { folder: { select: { name: true } } },
    });
    return note
      ? { ok: true, data: serializeNote(note) }
      : { ok: false, error: "Note not found." };
  } catch (error) {
    unstable_rethrow(error);
    console.error("getNote failed:", error);
    return { ok: false, error: "Could not load note." };
  }
}

export async function createNote(input?: {
  title?: string;
  body?: string;
  color?: AccentColor;
  folderId?: string | null;
}): Promise<ActionResult<NoteItem>> {
  try {
    const { profile } = await ensureNotesProfile();
    const folderId = input?.folderId ?? null;
    if (folderId) {
      const folder = await prisma.folder.findFirst({ where: { id: folderId, ownerId: profile.id }, select: { id: true } });
      if (!folder) return { ok: false, error: "Folder not found." };
    }
    const maxSort = await prisma.note.aggregate({
      where: { ownerId: profile.id },
      _max: { sortOrder: true },
    });
    const nextSort = Math.min((maxSort._max.sortOrder ?? -1) + 1, MAX_NOTE_SORT_ORDER);

    const note = await prisma.note.create({
      data: {
        ownerId: profile.id,
        title: cleanNoteTitle(input?.title ?? "Untitled note"),
        body: cleanNoteBody(await storedNoteBodyToMarkdown(input?.body ?? "")),
        color: isAccentColor(input?.color) ? input.color : "default",
        folderId,
        sortOrder: nextSort,
      },
      include: { folder: { select: { name: true } } },
    });
    return { ok: true, data: serializeNote(note) };
  } catch (error) {
    unstable_rethrow(error);
    console.error("createNote failed:", error);
    return { ok: false, error: "Could not create note." };
  }
}

export async function updateNote(input: {
  id: string;
  title?: string;
  body?: string;
  color?: AccentColor;
}): Promise<ActionResult<NoteItem>> {
  const { profile } = await ensureNotesProfile();
  const data: { title?: string; body?: string; color?: AccentColor } = {};

  if (typeof input.title === "string") data.title = cleanNoteTitle(input.title);
  if (typeof input.body === "string") data.body = cleanNoteBody(await storedNoteBodyToMarkdown(input.body));
  if (isAccentColor(input.color)) data.color = input.color;

  // Any save is the lazy migration point for a legacy prefixed body, even if
  // this particular patch only changed the title or color.
  if (typeof input.body !== "string") {
    const current = await prisma.note.findFirst({
      where: { id: input.id, ownerId: profile.id },
      select: { body: true },
    });
    if (current?.body.startsWith(RICH_TEXT_PREFIX)) {
      data.body = cleanNoteBody(await storedNoteBodyToMarkdown(current.body));
    }
  }

  if (Object.keys(data).length === 0) {
    const existing = await prisma.note.findFirst({
      where: { id: input.id, ownerId: profile.id },
      include: { folder: { select: { name: true } } },
    });
    return existing ? { ok: true, data: serializeNote(existing) } : { ok: false, error: "Note not found." };
  }

  try {
    const result = await prisma.note.updateMany({
      where: { id: input.id, ownerId: profile.id },
      data,
    });
    if (result.count === 0) return { ok: false, error: "Note not found." };

    const note = await prisma.note.findFirst({
      where: { id: input.id, ownerId: profile.id },
      include: { folder: { select: { name: true } } },
    });
    if (!note) return { ok: false, error: "Note not found." };
    return { ok: true, data: serializeNote(note) };
  } catch (error) {
    console.error("updateNote failed:", error);
    return { ok: false, error: "Could not save note." };
  }
}

export async function createFolder(name: string): Promise<ActionResult<FolderItem>> {
  const { profile } = await ensureNotesProfile();
  const cleaned = cleanFolderName(name);
  if (!cleaned) return { ok: false, error: "Folder name is required." };
  const nameKey = folderNameKey(cleaned);

  const duplicate = await prisma.folder.findFirst({
    where: { ownerId: profile.id, nameKey },
    select: { id: true },
  });
  if (duplicate) return { ok: false, error: "A folder with that name already exists." };

  try {
    const folder = await prisma.folder.create({
      data: { ownerId: profile.id, name: cleaned, nameKey },
      include: { _count: { select: { notes: true } } },
    });
    return { ok: true, data: serializeFolder(folder) };
  } catch (error) {
    console.error("createFolder failed:", error);
    return { ok: false, error: "Could not create folder." };
  }
}

export async function renameFolder(input: { id: string; name: string }): Promise<ActionResult<FolderItem>> {
  const { profile } = await ensureNotesProfile();
  const cleaned = cleanFolderName(input.name);
  if (!cleaned) return { ok: false, error: "Folder name is required." };
  const nameKey = folderNameKey(cleaned);

  const [folder, duplicate] = await Promise.all([
    prisma.folder.findFirst({ where: { id: input.id, ownerId: profile.id }, select: { id: true } }),
    prisma.folder.findFirst({ where: { ownerId: profile.id, nameKey, id: { not: input.id } }, select: { id: true } }),
  ]);
  if (!folder) return { ok: false, error: "Folder not found." };
  if (duplicate) return { ok: false, error: "A folder with that name already exists." };

  try {
    const updated = await prisma.folder.update({
      where: { id: input.id },
      data: { name: cleaned, nameKey },
      include: { _count: { select: { notes: true } } },
    });
    return { ok: true, data: serializeFolder(updated) };
  } catch (error) {
    console.error("renameFolder failed:", error);
    return { ok: false, error: "Could not rename folder." };
  }
}

export async function deleteFolder(folderId: string): Promise<ActionResult<{ id: string; movedNoteCount: number }>> {
  const { profile } = await ensureNotesProfile();
  const owned = await prisma.folder.findFirst({ where: { id: folderId, ownerId: profile.id }, select: { id: true } });
  if (!owned) return { ok: false, error: "Folder not found." };

  try {
    const data = await prisma.$transaction(async (tx) => {
      const moved = await tx.note.updateMany({
        where: { ownerId: profile.id, folderId },
        data: { folderId: null },
      });
      const deleted = await tx.folder.deleteMany({ where: { id: folderId, ownerId: profile.id } });
      if (!deleted.count) throw new Error("Folder disappeared while deleting.");
      return { id: folderId, movedNoteCount: moved.count };
    });
    return { ok: true, data };
  } catch (error) {
    console.error("deleteFolder failed:", error);
    return { ok: false, error: "Could not delete folder." };
  }
}

export async function moveNoteToFolder(input: { noteId: string; folderId: string | null }): Promise<ActionResult<NoteItem>> {
  const { profile } = await ensureNotesProfile();
  if (input.folderId) {
    const folder = await prisma.folder.findFirst({
      where: { id: input.folderId, ownerId: profile.id },
      select: { id: true },
    });
    if (!folder) return { ok: false, error: "Folder not found." };
  }

  try {
    const moved = await prisma.note.updateMany({
      where: { id: input.noteId, ownerId: profile.id },
      data: { folderId: input.folderId },
    });
    if (!moved.count) return { ok: false, error: "Note not found." };
    const note = await prisma.note.findFirst({
      where: { id: input.noteId, ownerId: profile.id },
      include: { folder: { select: { name: true } } },
    });
    return note ? { ok: true, data: serializeNote(note) } : { ok: false, error: "Note not found." };
  } catch (error) {
    console.error("moveNoteToFolder failed:", error);
    return { ok: false, error: "Could not move note." };
  }
}

export async function deleteNote(noteId: string, draft?: { title: string; body: string }): Promise<ActionResult<{ id: string }>> {
  const { profile } = await ensureNotesProfile();

  try {
    const data = draft ? { title: cleanNoteTitle(draft.title), body: cleanNoteBody(await storedNoteBodyToMarkdown(draft.body)) } : null;
    const result = await prisma.$transaction(async (tx) => {
      if (data) await tx.note.updateMany({ where: { id: noteId, ownerId: profile.id }, data });
      return moveNoteToTrash(tx, profile.id, noteId);
    }, { isolationLevel: "Serializable" });
    if (!result) return { ok: false, error: "Note not found." };
    return { ok: true, data: { id: noteId } };
  } catch (error) {
    console.error("deleteNote failed:", error);
    return { ok: false, error: "Could not delete note." };
  }
}

export async function reorderNotes(noteIds: string[]): Promise<ActionResult<NoteItem[]>> {
  const { profile } = await ensureNotesProfile();
  const uniqueIds = Array.from(new Set(noteIds.filter(Boolean)));
  if (uniqueIds.length !== noteIds.length) {
    return { ok: false, error: "Invalid note order." };
  }

  const owned = await prisma.note.findMany({
    where: { ownerId: profile.id, id: { in: uniqueIds } },
    select: { id: true },
  });

  if (owned.length !== uniqueIds.length) {
    return { ok: false, error: "Invalid note order." };
  }

  // The ids must be a complete permutation of this account's notes. A partial
  // list would renumber only part of the collection and leave two notes sharing
  // a sortOrder, which shows up later as an order that shuffles on reload.
  const total = await prisma.note.count({ where: { ownerId: profile.id } });
  if (uniqueIds.length !== total) {
    return { ok: false, error: "Note order is out of date. Reload and try again." };
  }
  if (total > NOTE_PAGE_SIZE) {
    return { ok: false, error: "Reordering is available when all notes fit on one page." };
  }

  try {
    await prisma.$transaction(
      uniqueIds.map((id, index) =>
        prisma.note.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    );

    const notes = await prisma.note.findMany({
      where: { ownerId: profile.id },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: NOTE_METADATA_SELECT,
    });
    const excerpts = await getNoteExcerpts(notes.map((note) => note.id));
    return {
      ok: true,
      data: notes.map((note) => serializeNoteSummary(note, excerpts.get(note.id) ?? "")),
    };
  } catch (error) {
    console.error("reorderNotes failed:", error);
    return { ok: false, error: "Could not reorder notes." };
  }
}

export async function updateSettings(input: Partial<{
  colorMode: ColorMode;
  accentColor: AccentColor;
  wallpaper: WallpaperId;
  wallpaperBlur: boolean;
  glassEnabled: boolean;
  sidebarTransparent: boolean;
}>): Promise<ActionResult<NotesSettings>> {
  const { profile } = await ensureNotesProfile();
  const data: Partial<{
    colorMode: ColorMode;
    accentColor: AccentColor;
    wallpaper: WallpaperId;
    wallpaperBlur: boolean;
    glassEnabled: boolean;
    sidebarTransparent: boolean;
  }> = {};

  if (isColorMode(input.colorMode)) data.colorMode = input.colorMode;
  if (isAccentColor(input.accentColor)) data.accentColor = input.accentColor;
  if (isWallpaperId(input.wallpaper)) data.wallpaper = input.wallpaper;
  if (typeof input.wallpaperBlur === "boolean") data.wallpaperBlur = input.wallpaperBlur;
  if (typeof input.glassEnabled === "boolean") data.glassEnabled = input.glassEnabled;
  if (typeof input.sidebarTransparent === "boolean") data.sidebarTransparent = input.sidebarTransparent;

  if (Object.keys(data).length === 0) {
    return { ok: true, data: serializeSettings(profile) };
  }

  try {
    const updated = await prisma.notesProfile.update({
      where: { id: profile.id },
      data,
    });
    return { ok: true, data: serializeSettings(updated) };
  } catch (error) {
    console.error("updateSettings failed:", error);
    return { ok: false, error: "Could not save settings." };
  }
}

export async function loadDeletedNotes(cursor?: string) {
  const { profile } = await ensureNotesProfile();
  const rows = await prisma.noteTrash.findMany({ where: { ownerId: profile.id }, orderBy: [{ deletedAt: "desc" }, { id: "desc" }], take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, title: true, deletedAt: true } });
  return { items: rows.slice(0, 50).map((row) => ({ ...row, deletedAt: row.deletedAt.toISOString(), canPurge: true })), nextCursor: rows.length > 50 ? rows[49].id : null };
}

export async function restoreDeletedNote(trashId: string) {
  const { profile } = await ensureNotesProfile();
  try {
    await prisma.$transaction((tx) => restoreTrashedNote(tx, profile.id, trashId), { isolationLevel: "Serializable" });
    return {};
  } catch { return { error: "Could not restore this note. Try again." }; }
}

export async function purgeDeletedNote(trashId: string) {
  const { profile } = await ensureNotesProfile();
  const result = await prisma.noteTrash.deleteMany({ where: { id: trashId, ownerId: profile.id } });
  return result.count ? {} : { error: "This deleted note is unavailable." };
}
