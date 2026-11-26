import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
import { auth } from "@/lib/auth-server";
import { prisma } from "@/lib/prisma";
import {
  decodeNoteCursor,
  encodeNoteCursor,
  normalizeNoteQuery,
  NOTE_METADATA_SELECT,
  NOTE_PAGE_SIZE,
} from "@/lib/note-pagination";
import type {
  AccentColor,
  ColorMode,
  FolderItem,
  NoteItem,
  NotesAppData,
  NotesPage,
  NotesSettings,
  WallpaperId,
} from "@/lib/types";
import { loginUrl, usesSharedAuth } from "@/lib/auth-mode";
import { excerptFromNoteBody } from "@/lib/notes-view";
import { qualifiedPostgresTable } from "@/lib/postgres-connection";

const ACCENTS = ["default", "green", "blue", "purple", "coral", "gold"] as const;
const COLOR_MODES = ["auto", "light", "dark"] as const;
const WALLPAPERS = ["none", "wp1", "wp2", "wp3", "wp4", "wp5", "wp6", "wp7", "wp8", "wp9", "wp10"] as const;

export function isAccentColor(value: unknown): value is AccentColor {
  return typeof value === "string" && ACCENTS.includes(value as AccentColor);
}

export function isColorMode(value: unknown): value is ColorMode {
  return typeof value === "string" && COLOR_MODES.includes(value as ColorMode);
}

export function isWallpaperId(value: unknown): value is WallpaperId {
  return typeof value === "string" && WALLPAPERS.includes(value as WallpaperId);
}

function serializeNote(note: {
  id: string;
  title: string;
  body: string;
  color: string;
  sortOrder: number;
  folderId: string | null;
  folder: { name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}): NoteItem {
  return {
    id: note.id,
    title: note.title,
    body: note.body,
    excerpt: excerptFromNoteBody(note.body),
    color: isAccentColor(note.color) ? note.color : "default",
    sortOrder: note.sortOrder,
    folderId: note.folderId,
    folderName: note.folder?.name ?? null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

function serializeNoteSummary(note: {
  id: string;
  title: string;
  color: string;
  sortOrder: number;
  folderId: string | null;
  folder: { name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}, excerpt: string): NoteItem {
  return {
    id: note.id,
    title: note.title,
    body: null,
    excerpt,
    color: isAccentColor(note.color) ? note.color : "default",
    sortOrder: note.sortOrder,
    folderId: note.folderId,
    folderName: note.folder?.name ?? null,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

async function getNoteExcerpts(noteIds: string[]) {
  if (noteIds.length === 0) return new Map<string, string>();

  // Read only a bounded prefix for sidebar previews. Full bodies remain out of
  // both the metadata query and the browser list payload.
  const rows = await prisma.$queryRaw<Array<{ id: string; body: string }>>(
    Prisma.sql`SELECT "id", LEFT("body", 2048) AS "body" FROM ${Prisma.raw(qualifiedPostgresTable("Note"))} WHERE "id" IN (${Prisma.join(noteIds)})`,
  );
  return new Map(rows.map((row) => [row.id, excerptFromNoteBody(row.body)]));
}

function serializeFolder(folder: {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  _count: { notes: number };
}): FolderItem {
  return {
    id: folder.id,
    name: folder.name,
    noteCount: folder._count.notes,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
  };
}

function serializeSettings(profile: {
  id: string;
  colorMode: string;
  accentColor: string;
  wallpaper: string;
  wallpaperBlur: boolean;
  glassEnabled: boolean;
  sidebarTransparent: boolean;
}): NotesSettings {
  return {
    id: profile.id,
    colorMode: isColorMode(profile.colorMode) ? profile.colorMode : "auto",
    accentColor: isAccentColor(profile.accentColor) ? profile.accentColor : "default",
    wallpaper: isWallpaperId(profile.wallpaper) ? profile.wallpaper : "none",
    wallpaperBlur: profile.wallpaperBlur,
    glassEnabled: profile.glassEnabled,
    sidebarTransparent: profile.sidebarTransparent,
  };
}

const starterBody = `Welcome to Notes.

- Capture a thought, plan, or project.
- Break it into small ordered points.
- Use the sidebar to keep notes sorted.

Notes saves changes as you type, so the structure stays responsive while the database stays current.`;

export const ensureNotesProfile = cache(async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    const appUrl = process.env.BETTER_AUTH_URL || "http://localhost:3000";
    const target = loginUrl(appUrl);
    if (usesSharedAuth) target.searchParams.set("redirect", appUrl);
    redirect(target.toString());
  }

  let profile = await prisma.notesProfile.findUnique({
    where: { id: session.user.id },
  });

  if (!profile) {
    profile = await prisma.notesProfile.create({
      data: {
        id: session.user.id,
        notes: {
          create: {
            title: "Welcome to Notes",
            body: starterBody,
            color: "default",
            sortOrder: 0,
          },
        },
      },
    });
  }

  return { profile, session };
});

export async function getNotesPageForProfile(
  profileId: string,
  input: { cursor?: string; query?: string; folderId?: string | null } = {},
): Promise<NotesPage> {
  const query = normalizeNoteQuery(input.query);
  const offset = decodeNoteCursor(input.cursor);
  const where = {
    ownerId: profileId,
    ...(query
      ? {
          OR: [
            { title: { contains: query, mode: "insensitive" as const } },
            { body: { contains: query, mode: "insensitive" as const } },
          ],
        }
      : input.folderId === undefined
        ? {}
        : { folderId: input.folderId }),
  };

  const [notes, totalCount, folderData] = await Promise.all([
    prisma.note.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      skip: offset,
      take: NOTE_PAGE_SIZE,
      select: NOTE_METADATA_SELECT,
    }),
    prisma.note.count({ where }),
    getFoldersForProfile(profileId),
  ]);
  const allNotesCount = folderData.unfiledCount
    + folderData.folders.reduce((count, folder) => count + folder.noteCount, 0);
  const excerpts = await getNoteExcerpts(notes.map((note) => note.id));

  return {
    items: notes.map((note) => serializeNoteSummary(note, excerpts.get(note.id) ?? "")),
    totalCount,
    nextCursor:
      offset + notes.length < totalCount ? encodeNoteCursor(offset + notes.length) : null,
    folders: folderData.folders,
    unfiledCount: folderData.unfiledCount,
    allNotesCount,
  };
}

export async function getFoldersForProfile(profileId: string) {
  const [folders, unfiledCount] = await Promise.all([
    prisma.folder.findMany({
      where: { ownerId: profileId },
      orderBy: [{ nameKey: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { notes: true } } },
    }),
    prisma.note.count({ where: { ownerId: profileId, folderId: null } }),
  ]);

  return { folders: folders.map(serializeFolder), unfiledCount };
}

export async function getNotesAppData(selectedId?: string): Promise<NotesAppData> {
  const { profile, session } = await ensureNotesProfile();
  const selectedNote = await prisma.note.findFirst({
    where: {
      ownerId: profile.id,
      ...(selectedId ? { id: selectedId } : {}),
    },
    ...(!selectedId
      ? { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] }
      : {}),
    include: { folder: { select: { name: true } } },
  });
  const page = await getNotesPageForProfile(profile.id, {
    folderId: selectedNote?.folderId ?? null,
  });

  return {
    name: session.user.name,
    email: session.user.email,
    settings: serializeSettings(profile),
    folders: page.folders,
    unfiledCount: page.unfiledCount,
    notes: page.items,
    selectedNote: selectedNote ? serializeNote(selectedNote) : null,
    totalCount: page.totalCount,
    nextCursor: page.nextCursor,
  };
}

export { getNoteExcerpts, serializeFolder, serializeNote, serializeNoteSummary, serializeSettings };
