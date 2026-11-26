import { beforeEach, describe, expect, it, vi } from "vitest";

type FixtureTask = {
  id: string;
  title: string;
  notes: null;
  dueDate: Date | null;
  isCompleted: boolean;
  isImportant: boolean;
  isMyDay: boolean;
  sortOrder: number;
  listId: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  subtasks: [];
  list: { name: string };
  personalStates: Array<{ isImportant: boolean; isMyDay: boolean }>;
};

const fixtures: FixtureTask[] = Array.from({ length: 10_000 }, (_, index) => ({
  id: `task-${index.toString().padStart(5, "0")}`,
  title: `Task ${index.toString().padStart(5, "0")}`,
  notes: null,
  dueDate: index % 3 === 0 ? new Date(Date.UTC(2026, 0, 1 + (index % 28))) : null,
  isCompleted: index >= 8_000,
  isImportant: index % 5 === 0,
  isMyDay: index % 4 === 0,
  sortOrder: index,
  listId: "list-1",
  createdById: "user-1",
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
  updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
  subtasks: [],
  list: { name: "Tasks" },
  personalStates: [{ isImportant: index % 5 === 0, isMyDay: index % 4 === 0 }],
}));

const mocks = {
  ensureTodoProfile: vi.fn(),
  revalidatePath: vi.fn(),
  taskCount: vi.fn(),
  taskFindMany: vi.fn(),
  taskUpdateMany: vi.fn(),
  listUpdateMany: vi.fn(),
};

function applyWhere(where: Record<string, unknown>) {
  return fixtures.filter((task) => {
    if (where.listId && task.listId !== where.listId) return false;
    if (typeof where.isCompleted === "boolean" && task.isCompleted !== where.isCompleted) return false;
    if (where.isMyDay === true && !task.isMyDay) return false;
    if (where.isImportant === true && !task.isImportant) return false;
    if (where.dueDate && task.dueDate === null) return false;
    return task.title !== "";
  });
}

function orderRows(rows: FixtureTask[], orderBy: Array<Record<string, unknown>>) {
  return [...rows].sort((left, right) => {
    for (const order of orderBy) {
      const [field, rawDirection] = Object.entries(order)[0];
      const direction = typeof rawDirection === "string" ? rawDirection : (rawDirection as { sort: string }).sort;
      const leftValue = left[field as keyof FixtureTask];
      const rightValue = right[field as keyof FixtureTask];
      const comparableLeft = leftValue instanceof Date ? leftValue.getTime() : leftValue;
      const comparableRight = rightValue instanceof Date ? rightValue.getTime() : rightValue;
      if (comparableLeft === comparableRight) continue;
      if (comparableLeft === null) return 1;
      if (comparableRight === null) return -1;
      const comparison = comparableLeft < comparableRight ? -1 : 1;
      return direction === "desc" ? -comparison : comparison;
    }
    return 0;
  });
}

function pageRows(args: {
  where: Record<string, unknown>;
  orderBy: Array<Record<string, unknown>>;
  cursor?: { id: string };
  skip?: number;
  take: number;
  select?: Record<string, boolean>;
}) {
  const ordered = orderRows(applyWhere(args.where), args.orderBy);
  const cursorIndex = args.cursor ? ordered.findIndex((task) => task.id === args.cursor!.id) : -1;
  const start = cursorIndex >= 0 ? cursorIndex + (args.skip ?? 0) : 0;
  const page = ordered.slice(start, start + args.take);
  if (!args.select) return page;
  return page.map((task) => ({
    id: task.id,
    title: task.title,
    isCompleted: task.isCompleted,
    isImportant: task.isImportant,
    isMyDay: task.isMyDay,
    createdById: task.createdById,
    personalStates: task.personalStates,
  }));
}

vi.doMock("@/lib/auth", () => ({ ensureTodoProfile: mocks.ensureTodoProfile }));
vi.doMock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.doMock("@/lib/prisma", () => {
  const mockPrisma = {
    task: {
      count: mocks.taskCount,
      findMany: mocks.taskFindMany,
      updateMany: mocks.taskUpdateMany,
    },
    list: { updateMany: mocks.listUpdateMany },
    $transaction: vi.fn((callback) => callback(mockPrisma)),
  };
  return { prisma: mockPrisma };
});

const actions = await import("@/app/actions");

describe("10,000-task pagination acceptance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureTodoProfile.mockResolvedValue({ id: "user-1" });
    mocks.taskCount.mockImplementation(({ where }) => Promise.resolve(applyWhere(where).length));
    mocks.taskFindMany.mockImplementation((args) => {
      if (args.select?.listId) {
        const idFilter = args.where.id?.in as string[];
        return Promise.resolve(fixtures.filter((task) => idFilter.includes(task.id)).map((task) => ({ id: task.id, listId: task.listId })));
      }
      return Promise.resolve(pageRows(args));
    });
    mocks.taskUpdateMany.mockResolvedValue({ count: 1 });
    mocks.listUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("reaches every active and completed task exactly once with bounded pages and exact counts", async () => {
    for (const [completed, expectedCount] of [[false, 8_000], [true, 2_000]] as const) {
      const ids = new Set<string>();
      let cursor: string | null = null;
      do {
        const page = await actions.getTaskPage({
          scope: { kind: "list", listId: "list-1" },
          completed,
          sort: "created",
          direction: "desc",
          cursor,
        });
        expect(page.totalCount).toBe(expectedCount);
        expect(page.items.length).toBeLessThanOrEqual(100);
        for (const task of page.items) ids.add(task.id);
        cursor = page.nextCursor;
      } while (cursor);

      expect(ids.size).toBe(expectedCount);
    }
  });

  it("loads both halves of a task view with one authenticated user lookup", async () => {
    const result = await actions.getTaskView({
      scope: { kind: "list", listId: "list-1" },
      sort: "created",
      direction: "desc",
    });

    expect(mocks.ensureTodoProfile).toHaveBeenCalledTimes(1);
    expect(result.active.totalCount).toBe(8_000);
    expect(result.completed.totalCount).toBe(2_000);
    expect(result.active.items).toHaveLength(100);
    expect(result.completed.items).toHaveLength(100);
  });

  it("pages through all search matches and bulk-updates a task discovered after the first page", async () => {
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await actions.searchTasks("Task", "all", 20, cursor);
      expect(page.totalCount).toBe(10_000);
      expect(page.items.length).toBeLessThanOrEqual(20);
      ids.push(...page.items.map((task) => task.id));
      cursor = page.nextCursor;
    } while (cursor);

    expect(new Set(ids).size).toBe(10_000);
    const latePageTaskId = ids.at(-1)!;
    await actions.bulkCompleteTasks([latePageTaskId]);
    expect(mocks.taskUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [latePageTaskId] } },
      data: { isCompleted: true },
    });
  });
});
