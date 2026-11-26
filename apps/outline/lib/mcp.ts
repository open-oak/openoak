import { moveNoteToTrash } from "./note-recovery";
import { prisma } from "./prisma";
import { storedNoteBodyToMarkdown } from "./note-markdown-server";
import { cleanNoteBody, cleanNoteTitle, MAX_NOTE_SORT_ORDER } from "./note-validation";
import { cleanFolderName, folderNameKey } from "./folder-validation";

const ACCENT_COLORS = new Set(["default", "green", "blue", "purple", "coral", "gold"]);
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export type OutlineMcpErrorCode = "invalid" | "not_found" | "conflict";

export class OutlineMcpError extends Error {
  constructor(
    public readonly code: OutlineMcpErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "OutlineMcpError";
  }
}

export type OutlineMcpNote = {
  id: string;
  title: string;
  body: string;
  color: string;
  sortOrder: number;
  folder: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  url: string;
};

export type OutlineMcpFolder = {
  id: string;
  name: string;
  noteCount: number;
  createdAt: string;
  updatedAt: string;
};

function pageSize(limit?: number) {
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit ?? DEFAULT_LIMIT)));
}

function parseCursor(cursor?: string) {
  if (!cursor) return 0;
  try {
    const value = Number.parseInt(Buffer.from(cursor, "base64url").toString("utf8"), 10);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error();
    return value;
  } catch {
    throw new OutlineMcpError("invalid", "Invalid pagination cursor.");
  }
}

function nextCursor(offset: number, hasMore: boolean, limit: number) {
  return hasMore ? Buffer.from(String(offset + limit)).toString("base64url") : undefined;
}

function expectedDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new OutlineMcpError("invalid", "expectedUpdatedAt must be an ISO timestamp.");
  return parsed;
}

function noteUrl(id: string) {
  const base = (process.env.OUTLINE_PUBLIC_URL || "https://outline.openoak.org").replace(/\/$/, "");
  return `${base}/?note=${encodeURIComponent(id)}`;
}

async function serializeNote(note: {
  id: string;
  title: string;
  body: string;
  color: string;
  sortOrder: number;
  folder: { id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}): Promise<OutlineMcpNote> {
  return {
    id: note.id,
    title: note.title,
    body: await storedNoteBodyToMarkdown(note.body),
    color: ACCENT_COLORS.has(note.color) ? note.color : "default",
    sortOrder: note.sortOrder,
    folder: note.folder,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
    url: noteUrl(note.id),
  };
}

function serializeFolder(folder: {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  _count: { notes: number };
}): OutlineMcpFolder {
  return {
    id: folder.id,
    name: folder.name,
    noteCount: folder._count.notes,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  };
}

async function ensureProfile(userId: string) {
  await prisma.notesProfile.upsert({ where: { id: userId }, create: { id: userId }, update: {} });
}

async function ensureOwnedFolder(userId: string, folderId: string) {
  const folder = await prisma.folder.findFirst({ where: { id: folderId, ownerId: userId }, select: { id: true } });
  if (!folder) throw new OutlineMcpError("not_found", "Folder not found.");
}

export async function outlineListFolders(userId: string) {
  const folders = await prisma.folder.findMany({
    where: { ownerId: userId },
    orderBy: [{ nameKey: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { notes: true } } },
  });
  return { items: folders.map(serializeFolder) };
}

export async function outlineCreateFolder(userId: string, input: { name: string }) {
  await ensureProfile(userId);
  const name = cleanFolderName(input.name);
  if (!name) throw new OutlineMcpError("invalid", "Folder name is required.");
  const nameKey = folderNameKey(name);
  const duplicate = await prisma.folder.findFirst({ where: { ownerId: userId, nameKey }, select: { id: true } });
  if (duplicate) throw new OutlineMcpError("conflict", "A folder with that name already exists.");
  const folder = await prisma.folder.create({
    data: { ownerId: userId, name, nameKey },
    include: { _count: { select: { notes: true } } },
  });
  return serializeFolder(folder);
}

export async function outlineUpdateFolder(userId: string, input: { id: string; expectedUpdatedAt: string; name: string }) {
  const expected = expectedDate(input.expectedUpdatedAt);
  const name = cleanFolderName(input.name);
  if (!name) throw new OutlineMcpError("invalid", "Folder name is required.");
  const nameKey = folderNameKey(name);
  const duplicate = await prisma.folder.findFirst({ where: { ownerId: userId, nameKey, id: { not: input.id } }, select: { id: true } });
  if (duplicate) throw new OutlineMcpError("conflict", "A folder with that name already exists.");
  const updated = await prisma.folder.updateMany({
    where: { id: input.id, ownerId: userId, updatedAt: expected },
    data: { name, nameKey },
  });
  if (!updated.count) {
    const current = await prisma.folder.findFirst({ where: { id: input.id, ownerId: userId }, select: { updatedAt: true } });
    if (!current) throw new OutlineMcpError("not_found", "Folder not found.");
    throw new OutlineMcpError("conflict", "The folder changed after it was read.", { currentUpdatedAt: current.updatedAt.toISOString() });
  }
  const folder = await prisma.folder.findUnique({ where: { id: input.id }, include: { _count: { select: { notes: true } } } });
  if (!folder) throw new OutlineMcpError("not_found", "Folder not found.");
  return serializeFolder(folder);
}

export async function outlineDeleteFolder(userId: string, input: { id: string; expectedUpdatedAt: string }) {
  const expected = expectedDate(input.expectedUpdatedAt);
  return prisma.$transaction(async (tx) => {
    const current = await tx.folder.findFirst({ where: { id: input.id, ownerId: userId }, select: { updatedAt: true } });
    if (!current) return { id: input.id, deleted: false, alreadyAbsent: true, movedNoteCount: 0 };
    if (current.updatedAt.getTime() !== expected.getTime()) {
      throw new OutlineMcpError("conflict", "The folder changed after it was read.", { currentUpdatedAt: current.updatedAt.toISOString() });
    }
    const moved = await tx.note.updateMany({ where: { ownerId: userId, folderId: input.id }, data: { folderId: null } });
    const deleted = await tx.folder.deleteMany({ where: { id: input.id, ownerId: userId, updatedAt: expected } });
    if (!deleted.count) throw new OutlineMcpError("conflict", "The folder changed while it was being deleted.");
    return { id: input.id, deleted: true, alreadyAbsent: false, movedNoteCount: moved.count };
  });
}

export async function outlineListNotes(userId: string, input: { query?: string; folderId?: string | null; limit?: number; cursor?: string } = {}) {
  const limit = pageSize(input.limit);
  const offset = parseCursor(input.cursor);
  const query = input.query?.trim();
  if (input.folderId) await ensureOwnedFolder(userId, input.folderId);
  const notes = await prisma.note.findMany({
    where: {
      ownerId: userId,
      ...(input.folderId === undefined ? {} : { folderId: input.folderId }),
      ...(query ? { OR: [{ title: { contains: query, mode: "insensitive" } }, { body: { contains: query, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    skip: offset,
    take: limit + 1,
    include: { folder: { select: { id: true, name: true } } },
  });
  const page = notes.slice(0, limit);
  return { items: await Promise.all(page.map(serializeNote)), nextCursor: nextCursor(offset, notes.length > limit, limit) };
}

export async function outlineGetNote(userId: string, id: string) {
  const note = await prisma.note.findFirst({ where: { id, ownerId: userId }, include: { folder: { select: { id: true, name: true } } } });
  if (!note) throw new OutlineMcpError("not_found", "Note not found.");
  return serializeNote(note);
}

export async function outlineCreateNote(userId: string, input: { title?: string; body?: string; color?: string; folderId?: string | null }) {
  await ensureProfile(userId);
  const folderId = input.folderId ?? null;
  if (folderId) await ensureOwnedFolder(userId, folderId);
  const maximum = await prisma.note.aggregate({ where: { ownerId: userId }, _max: { sortOrder: true } });
  const note = await prisma.note.create({
    data: {
      ownerId: userId,
      title: cleanNoteTitle(input.title ?? "Untitled note"),
      body: cleanNoteBody(await storedNoteBodyToMarkdown(input.body ?? "")),
      color: input.color && ACCENT_COLORS.has(input.color) ? input.color : "default",
      folderId,
      sortOrder: Math.min((maximum._max.sortOrder ?? -1) + 1, MAX_NOTE_SORT_ORDER),
    },
    include: { folder: { select: { id: true, name: true } } },
  });
  return serializeNote(note);
}

export async function outlineUpdateNote(
  userId: string,
  input: { id: string; expectedUpdatedAt: string; title?: string; body?: string; color?: string; folderId?: string | null },
) {
  const expected = expectedDate(input.expectedUpdatedAt);
  const data: { title?: string; body?: string; color?: string; folderId?: string | null } = {};
  if (typeof input.title === "string") data.title = cleanNoteTitle(input.title);
  if (typeof input.body === "string") data.body = cleanNoteBody(await storedNoteBodyToMarkdown(input.body));
  if (typeof input.color === "string") {
    if (!ACCENT_COLORS.has(input.color)) throw new OutlineMcpError("invalid", "Invalid note color.");
    data.color = input.color;
  }
  if (input.folderId !== undefined) {
    if (input.folderId) await ensureOwnedFolder(userId, input.folderId);
    data.folderId = input.folderId;
  }
  if (!Object.keys(data).length) throw new OutlineMcpError("invalid", "Provide at least one note field to update.");

  const updated = await prisma.note.updateMany({ where: { id: input.id, ownerId: userId, updatedAt: expected }, data });
  if (!updated.count) {
    const current = await prisma.note.findFirst({ where: { id: input.id, ownerId: userId }, select: { updatedAt: true } });
    if (!current) throw new OutlineMcpError("not_found", "Note not found.");
    throw new OutlineMcpError("conflict", "The note changed after it was read.", { currentUpdatedAt: current.updatedAt.toISOString() });
  }
  return outlineGetNote(userId, input.id);
}

export async function outlineDeleteNote(userId: string, input: { id: string; expectedUpdatedAt: string }) {
  const expected = expectedDate(input.expectedUpdatedAt);
  return prisma.$transaction(async (tx) => {
    const current = await tx.note.findFirst({ where: { id: input.id, ownerId: userId }, select: { updatedAt: true } });
    if (!current) return { id: input.id, deleted: false, alreadyAbsent: true };
    if (current.updatedAt.getTime() !== expected.getTime()) {
      throw new OutlineMcpError("conflict", "The note changed after it was read.", { currentUpdatedAt: current.updatedAt.toISOString() });
    }
    const deleted = await moveNoteToTrash(tx, userId, input.id, expected);
    if (!deleted) throw new OutlineMcpError("conflict", "The note changed while it was being deleted.");
    return { id: input.id, deleted: true, alreadyAbsent: false };
  }, { isolationLevel: "Serializable" });
}
