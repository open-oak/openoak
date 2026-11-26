import { requireSession } from "@/lib/auth";
import { KanbanApp } from "@/components/kanban-app";
import { initializeNewKanbanAccount } from "@/lib/kanban-sharing";
import { kanbanPool } from "@/lib/kanban-v2-db";

export default async function Page({ searchParams }: { searchParams: Promise<{ board?: string; card?: string }> }) {
  const session = await requireSession();
  const { board, card } = await searchParams;
  await initializeNewKanbanAccount(session.user.id);
  const state = (await kanbanPool().query('SELECT "storageMode" FROM "KanbanTransition" WHERE "ownerId"=$1', [session.user.id])).rows[0];
  // Shared links use stable public keys; owners may still have historical local IDs.
  const linked = board ? (await kanbanPool().query('SELECT "id" FROM "KanbanBoard" WHERE "boardKey"=$1 AND "ownerId"=$2', [board, session.user.id])).rows[0]?.id : undefined;
  return <KanbanApp accountId={session.user.id} modular={state?.storageMode === "modular"} name={session.user.name} email={session.user.email} initialBoardId={linked ?? board} initialCardId={card} />;
}
