import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = {
  ensureTodoProfile: vi.fn(),
  revalidatePath: vi.fn(),
  listFindFirst: vi.fn(),
  taskAggregate: vi.fn(),
  taskCreate: vi.fn(),
  taskFindFirst: vi.fn(),
  taskDeleteMany: vi.fn(),
  listUpdate: vi.fn(),
  transaction: vi.fn(),
};

const supportsModuleMocks = typeof vi.doMock === "function";

if (supportsModuleMocks) {
  vi.doMock("@/lib/auth", () => ({
    ensureTodoProfile: mocks.ensureTodoProfile,
  }));

  vi.doMock("next/cache", () => ({
    revalidatePath: mocks.revalidatePath,
  }));

  vi.doMock("@/lib/prisma", () => ({
    prisma: {
      task: {
        aggregate: mocks.taskAggregate,
        create: mocks.taskCreate,
        findFirst: mocks.taskFindFirst,
        deleteMany: mocks.taskDeleteMany,
      },
      list: {
        findFirst: mocks.listFindFirst,
        update: mocks.listUpdate,
      },
      $transaction: mocks.transaction,
    },
  }));
}

const actions = supportsModuleMocks ? await import("@/app/actions") : null;

const describeWithModuleMocks = supportsModuleMocks ? describe : describe.skip;

describeWithModuleMocks("task creation ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureTodoProfile.mockResolvedValue({ id: "user-1" });
    mocks.listFindFirst.mockResolvedValue(null);
    mocks.taskDeleteMany.mockResolvedValue({ count: 0 });
    mocks.transaction.mockImplementation(async (callback) => callback({
      task: {
        findFirst: mocks.taskFindFirst,
        deleteMany: mocks.taskDeleteMany,
      },
      list: { update: mocks.listUpdate },
    }));
  });

  it("does not quick-add a task into a list the user cannot edit", async () => {
    const formData = new FormData();
    formData.set("title", "Forged task");
    formData.set("listId", "other-user-list");

    const result = await actions!.addTask(formData);

    expect(result).toBeUndefined();
    expect(mocks.listFindFirst).toHaveBeenCalledWith({
      where: {
        id: "other-user-list",
        OR: [
          { ownerId: "user-1" },
          { kind: "CUSTOM", members: { some: { userId: "user-1" } } },
        ],
      },
      select: { id: true },
    });
    expect(mocks.taskAggregate).not.toHaveBeenCalled();
    expect(mocks.taskCreate).not.toHaveBeenCalled();
  });

  it("does not create a blank task into a list the user cannot edit", async () => {
    const result = await actions!.createBlankTask("other-user-list");

    expect(result).toBeUndefined();
    expect(mocks.listFindFirst).toHaveBeenCalledWith({
      where: {
        id: "other-user-list",
        OR: [
          { ownerId: "user-1" },
          { kind: "CUSTOM", members: { some: { userId: "user-1" } } },
        ],
      },
      select: { id: true },
    });
    expect(mocks.taskCreate).not.toHaveBeenCalled();
  });

  it("cleans abandoned blank drafts regardless of view metadata", async () => {
    await actions!.createBlankTask("other-user-list");

    const cleanupWhere = mocks.taskDeleteMany.mock.calls[0]?.[0]?.where;
    expect(cleanupWhere).toEqual(expect.objectContaining({
      title: "",
      isCompleted: false,
      OR: [{ notes: null }, { notes: "" }],
      subtasks: { none: {} },
    }));
    expect(cleanupWhere).not.toHaveProperty("isImportant");
    expect(cleanupWhere).not.toHaveProperty("isMyDay");
    expect(cleanupWhere).not.toHaveProperty("dueDate");
  });

  it("conditionally discards an editable task that is still blank", async () => {
    mocks.taskFindFirst.mockResolvedValue({ id: "blank-task", listId: "list-1" });
    mocks.taskDeleteMany.mockResolvedValue({ count: 1 });

    const result = await actions!.discardBlankTask("blank-task");

    expect(mocks.taskFindFirst).toHaveBeenCalledWith({
      where: {
        id: "blank-task",
        title: "",
        list: {
          OR: [
            { ownerId: "user-1" },
            { kind: "CUSTOM", members: { some: { userId: "user-1" } } },
          ],
        },
      },
      select: { id: true, listId: true },
    });
    expect(mocks.taskDeleteMany).toHaveBeenCalledWith({
      where: {
        id: "blank-task",
        title: "",
        list: {
          OR: [
            { ownerId: "user-1" },
            { kind: "CUSTOM", members: { some: { userId: "user-1" } } },
          ],
        },
      },
    });
    expect(mocks.listUpdate).toHaveBeenCalledWith({
      where: { id: "list-1" },
      data: { updatedAt: expect.any(Date) },
    });
    expect(result).toEqual({ discarded: true });
  });
});
