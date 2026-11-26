import { NotesApp } from "@/components/notes-app";
import { getNotesAppData } from "@/lib/notes-data";
import { NOTE_PAGE_SIZE } from "@/lib/note-pagination";

export default async function Page({ searchParams }: { searchParams: Promise<{ note?: string }> }) {
  const { note } = await searchParams;
  const data = await getNotesAppData(note);
  const accountUrl = process.env.NEXT_PUBLIC_ACCOUNT_URL?.trim() || "";

  return (
    <NotesApp
      name={data.name}
      email={data.email}
      initialNotes={data.notes}
      initialSelectedNote={data.selectedNote}
      initialTotalCount={data.totalCount}
      initialNextCursor={data.nextCursor}
      pageSize={NOTE_PAGE_SIZE}
      initialSettings={data.settings}
      initialFolders={data.folders}
      initialUnfiledCount={data.unfiledCount}
      accountUrl={accountUrl}
      initialSelectedId={data.selectedNote?.id}
    />
  );
}
