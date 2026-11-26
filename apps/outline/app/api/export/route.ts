import { ensureNotesProfile, serializeSettings } from "@/lib/notes-data";
import { prisma } from "@/lib/prisma";
import { createOutlineExport } from "@/lib/notes-export";
import { storedNoteBodyToMarkdown } from "@/lib/note-markdown-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { profile } = await ensureNotesProfile();
  const [folders, notes, deletedNotes] = await prisma.$transaction([
    prisma.folder.findMany({ where: { ownerId: profile.id }, orderBy: { id: "asc" }, select: { id: true, name: true, createdAt: true, updatedAt: true } }),
    prisma.note.findMany({ where: { ownerId: profile.id }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, title: true, body: true, color: true, sortOrder: true, folderId: true, createdAt: true, updatedAt: true } }),
    prisma.noteTrash.findMany({ where: { ownerId: profile.id }, orderBy: { id: "asc" }, select: { id: true, noteId: true, title: true, body: true, color: true, sortOrder: true, folderId: true, createdAt: true, updatedAt: true, deletedAt: true } }),
  ], { isolationLevel: "RepeatableRead" });
  const exportedAt = new Date();
  const settings = serializeSettings(profile);
  const body = createOutlineExport({ settings, folders,
    notes: notes.map((note) => ({ ...note, markdown: storedNoteBodyToMarkdown(note.body) })),
    deletedNotes: deletedNotes.map((note) => ({ ...note, markdown: storedNoteBodyToMarkdown(note.body) })),
  }, exportedAt);
  return new Response(body, { headers: {
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="openoutline-export-${exportedAt.toISOString().slice(0, 10)}.json"`,
  } });
}
