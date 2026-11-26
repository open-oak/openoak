import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportDocument } from "@/lib/todo-import";

const mocks = {
  lock: vi.fn(),
  listFindMany: vi.fn(),
  listCreate: vi.fn(),
  listUpdate: vi.fn(),
  taskFindMany: vi.fn(),
  taskAggregate: vi.fn(),
  taskCreateMany: vi.fn(),
  subtaskCreateMany: vi.fn(),
};

vi.doMock("@/lib/prisma", () => {
  const tx = {
    $executeRaw: mocks.lock,
    list: { findMany: mocks.listFindMany, create: mocks.listCreate, update: mocks.listUpdate },
    task: { findMany: mocks.taskFindMany, aggregate: mocks.taskAggregate, createMany: mocks.taskCreateMany },
    subtask: { createMany: mocks.subtaskCreateMany },
  };
  return {
    prisma: {
      $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx),
    },
  };
});

const { applyImport } = await import("@/lib/todo-import-server");

const created = new Date("2026-01-10T18:36:12.000Z");

function document(): ImportDocument {
  return {
    source: "microsoft-to-do",
    skipped: { flaggedEmailLists: 1, attachments: 0 },
    lists: [
      {
        name: "Tasks",
        isDefault: true,
        tasks: [
          { title: "Already here", notes: null, dueDate: null, isCompleted: false, isImportant: false, createdAt: created, steps: [] },
          { title: "New one", notes: "n", dueDate: null, isCompleted: false, isImportant: true, createdAt: null, steps: [{ title: "Step", isCompleted: true }] },
        ],
      },
      {
        name: "groceries",
        isDefault: false,
        tasks: [{ title: "Milk", notes: null, dueDate: null, isCompleted: true, isImportant: false, createdAt: null, steps: [] }],
      },
      {
        name: "Brand new",
        isDefault: false,
        tasks: [{ title: "First", notes: null, dueDate: null, isCompleted: false, isImportant: false, createdAt: created, steps: [] }],
      },
      { name: "Empty source list", isDefault: false, tasks: [] },
    ],
  };
}

describe("applyImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listFindMany.mockResolvedValue([
      { id: "default", name: "Tasks", kind: "DEFAULT", sortOrder: 0 },
      { id: "groceries", name: "Groceries", kind: "CUSTOM", sortOrder: 3 },
    ]);
    mocks.listCreate.mockResolvedValue({ id: "new-list" });
    mocks.taskFindMany.mockImplementation(({ where }: { where: { listId: string } }) => Promise.resolve(
      where.listId === "default" ? [{ title: "Already here", createdAt: created }] : [],
    ));
    mocks.taskAggregate.mockResolvedValue({ _max: { sortOrder: 4 } });
  });

  it("only writes into the user's own lists and skips tasks it imported before", async () => {
    const summary = await applyImport("user-1", document());

    expect(mocks.lock).toHaveBeenCalledExactlyOnceWith(expect.any(Array), "user-1");
    expect(mocks.lock).toHaveBeenCalledBefore(mocks.listFindMany);
    expect(mocks.listFindMany.mock.calls[0][0].where).toEqual({ ownerId: "user-1" });
    expect(summary).toEqual({
      listsCreated: 1,
      listsUpdated: 2,
      tasksImported: 3,
      tasksSkipped: 1,
      stepsImported: 1,
      flaggedEmailListsSkipped: 1,
      attachmentsSkipped: 0,
    });

    // The default source list goes to the default list; names match case-insensitively.
    const writes = mocks.taskCreateMany.mock.calls.map(([args]) => args.data);
    expect(writes[0]).toHaveLength(1);
    expect(writes[0][0]).toMatchObject({ title: "New one", listId: "default", createdById: "user-1", isImportant: true, sortOrder: 5 });
    expect(writes[1][0]).toMatchObject({ title: "Milk", listId: "groceries", isCompleted: true });
    expect(writes[2][0]).toMatchObject({ title: "First", listId: "new-list", createdAt: created });

    // Steps point at the id given to their own task.
    const steps = mocks.subtaskCreateMany.mock.calls[0][0].data;
    expect(steps).toEqual([{ taskId: writes[0][0].id, title: "Step", isCompleted: true, sortOrder: 0 }]);

    // A new list is created after the existing ones; an empty source list creates nothing.
    expect(mocks.listCreate).toHaveBeenCalledTimes(1);
    expect(mocks.listCreate.mock.calls[0][0].data).toEqual({ name: "Brand new", ownerId: "user-1", kind: "CUSTOM", sortOrder: 4 });
  });

  it("does not import a task twice when the source repeats it", async () => {
    const repeat = document();
    repeat.lists = [{ name: "Tasks", isDefault: true, tasks: [repeat.lists[0].tasks[1], repeat.lists[0].tasks[1]] }];
    const summary = await applyImport("user-1", repeat);
    expect(summary.tasksImported).toBe(1);
    expect(summary.tasksSkipped).toBe(1);
  });
});
