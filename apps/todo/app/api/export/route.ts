import { ensureTodoProfile } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createTodoExport } from "@/lib/todo-export";
import { projectPersonalTaskFlags } from "@/lib/todo-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await ensureTodoProfile();
  const { id: userId, ...settings } = user;
  const [ownedLists, sharedPersonalStates] = await Promise.all([
    prisma.list.findMany({
      where: { ownerId: userId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
      id: true,
      name: true,
      kind: true,
      themeColor: true,
      backgroundImage: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true,
      tasks: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          title: true,
          notes: true,
          dueDate: true,
          isCompleted: true,
          isImportant: true,
          isMyDay: true,
          createdById: true,
          sortOrder: true,
          createdAt: true,
          updatedAt: true,
          personalStates: {
            where: { userId },
            select: { isImportant: true, isMyDay: true },
            take: 1,
          },
          subtasks: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              title: true,
              isCompleted: true,
              sortOrder: true,
              createdAt: true,
              updatedAt: true,
            },
          },
        },
      },
      },
    }),
    prisma.taskPersonalState.findMany({
      where: {
        userId,
        task: {
          list: {
            ownerId: { not: userId },
            kind: "CUSTOM",
            members: { some: { userId } },
          },
        },
      },
      orderBy: [{ updatedAt: "asc" }, { taskId: "asc" }],
      select: {
        taskId: true,
        isImportant: true,
        isMyDay: true,
        updatedAt: true,
        task: { select: { listId: true } },
      },
    }),
  ]);
  const lists = ownedLists.map((list) => ({
    ...list,
    tasks: list.tasks.map((task) => projectPersonalTaskFlags(task, userId)),
  }));

  const exportedAt = new Date();
  const body = createTodoExport({
    settings,
    lists,
    sharedPersonalStates: sharedPersonalStates.map(({ task, ...state }) => ({
      ...state,
      listId: task.listId,
    })),
  }, exportedAt);
  const filename = `opentodo-export-${exportedAt.toISOString().slice(0, 10)}.json`;

  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
