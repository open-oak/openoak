import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateTask } from "@/app/actions";
import { MAX_TASK_NOTES_LENGTH, MAX_TASK_TITLE_LENGTH } from "@/lib/todo-validation";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  taskUpdate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ ensureTodoProfile: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("updateTask", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation((run) => run({
      task: {
        findFirst: vi.fn().mockResolvedValue({ id: "task-1", listId: "list-1" }),
        update: mocks.taskUpdate,
      },
      list: { update: vi.fn() },
    }));
  });

  it("only writes editable content and keeps the length limits", async () => {
    const title = "t".repeat(MAX_TASK_TITLE_LENGTH);
    const notes = "n".repeat(MAX_TASK_NOTES_LENGTH);
    const patch = {
      title: `  ${title}more  `,
      notes: `${notes}more`,
      isCompleted: false,
      listId: "other-list",
      createdById: "other-user",
    };

    await updateTask("task-1", patch);

    expect(mocks.taskUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: "task-1" },
      data: { title, notes, isCompleted: false },
    });
  });

  it("ignores fields with invalid types and accepts empty strings", async () => {
    const patch = { title: 12, notes: "", isCompleted: "true" };

    await updateTask("task-1", patch as unknown as Parameters<typeof updateTask>[1]);

    expect(mocks.taskUpdate).toHaveBeenCalledExactlyOnceWith({
      where: { id: "task-1" },
      data: { notes: "" },
    });
  });

  it("skips the write when the patch has no editable content", async () => {
    const patch = { title: undefined, extra: "ignored" };

    await updateTask("task-1", patch);

    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
