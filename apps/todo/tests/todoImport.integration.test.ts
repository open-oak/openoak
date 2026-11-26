import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseImportFile, parsePlainText } from "@/lib/todo-import";

// Runs against a migrated, disposable Postgres:
// TODO_INTEGRATION_DATABASE_URL=... DATABASE_URL=$TODO_INTEGRATION_DATABASE_URL npx vitest run tests/todoImport.integration.test.ts
const integration = describe.runIf(Boolean(process.env.TODO_INTEGRATION_DATABASE_URL));

let prisma: (typeof import("@/lib/prisma"))["prisma"];
let applyImport: (typeof import("@/lib/todo-import-server"))["applyImport"];

const exportFile = JSON.stringify([
  {
    displayName: "Tasks",
    wellKnownListName: "defaultList",
    tasks: [
      {
        title: "Pay rent",
        status: "notStarted",
        importance: "high",
        createdDateTime: "2026-01-10T18:36:12.0646821Z",
        body: { content: "Before the 1st", contentType: "text" },
        dueDateTime: { dateTime: "2026-02-01T00:00:00.0000000", timeZone: "UTC" },
        checklistItems: [{ displayName: "Check balance", isChecked: true }, { displayName: "Transfer", isChecked: false }],
      },
    ],
  },
  {
    displayName: "Groceries",
    wellKnownListName: "none",
    tasks: [{ title: "Milk", status: "completed", importance: "normal", createdDateTime: "2026-03-03T10:00:00Z" }],
  },
]);

integration("Todo import against migrated Postgres", () => {
  beforeAll(async () => {
    ({ prisma } = await import("@/lib/prisma"));
    ({ applyImport } = await import("@/lib/todo-import-server"));
  });

  beforeEach(async () => {
    await prisma.todoProfile.deleteMany();
    await prisma.todoProfile.createMany({ data: [{ id: "owner" }, { id: "other" }] });
    await prisma.list.create({ data: { id: "default", name: "Tasks", ownerId: "owner", kind: "DEFAULT" } });
    await prisma.list.create({ data: { id: "others-groceries", name: "Groceries", ownerId: "other", kind: "CUSTOM" } });
  });

  afterAll(async () => {
    await prisma.todoProfile.deleteMany();
    await prisma.$disconnect();
  });

  it("imports a Microsoft To Do export once, even when it runs twice", async () => {
    const first = await applyImport("owner", parseImportFile("mstodo_export.json", exportFile));
    expect(first).toMatchObject({ listsCreated: 1, listsUpdated: 1, tasksImported: 2, tasksSkipped: 0, stepsImported: 2 });

    const rent = await prisma.task.findFirstOrThrow({ where: { title: "Pay rent" }, include: { subtasks: { orderBy: { sortOrder: "asc" } } } });
    expect(rent).toMatchObject({ listId: "default", createdById: "owner", isImportant: true, isCompleted: false, notes: "Before the 1st" });
    expect(rent.dueDate?.toISOString()).toBe("2026-02-01T12:00:00.000Z");
    expect(rent.createdAt.toISOString()).toBe("2026-01-10T18:36:12.064Z");
    expect(rent.subtasks.map((step) => [step.title, step.isCompleted])).toEqual([["Check balance", true], ["Transfer", false]]);

    // The user's own new list, never another user's list with the same name.
    const groceries = await prisma.list.findFirstOrThrow({ where: { ownerId: "owner", name: "Groceries" }, include: { tasks: true } });
    expect(groceries.tasks.map((task) => [task.title, task.isCompleted])).toEqual([["Milk", true]]);
    expect(await prisma.task.count({ where: { listId: "others-groceries" } })).toBe(0);

    const second = await applyImport("owner", parseImportFile("mstodo_export.json", exportFile));
    expect(second).toMatchObject({ listsCreated: 0, tasksImported: 0, tasksSkipped: 2, stepsImported: 0 });
    expect(await prisma.task.count({ where: { createdById: "owner" } })).toBe(2);
  });

  it("appends pasted tasks after existing ones", async () => {
    await prisma.task.create({ data: { title: "Existing", listId: "default", createdById: "owner", sortOrder: 7 } });
    await applyImport("owner", parsePlainText("# Tasks\nNew task\n  A step", ""));
    const created = await prisma.list.findFirstOrThrow({ where: { ownerId: "owner", name: "Tasks", kind: "CUSTOM" }, include: { tasks: { include: { subtasks: true } } } });
    // Pasted "# Tasks" is a custom list name, not the default list.
    expect(created.tasks).toHaveLength(1);
    expect(created.tasks[0].subtasks.map((step) => step.title)).toEqual(["A step"]);

    await applyImport("owner", { source: "text", skipped: { flaggedEmailLists: 0, attachments: 0 }, lists: [{ name: "Tasks", isDefault: true, tasks: [{ title: "Later", notes: null, dueDate: null, isCompleted: false, isImportant: false, createdAt: null, steps: [] }] }] });
    const later = await prisma.task.findFirstOrThrow({ where: { title: "Later" } });
    expect(later).toMatchObject({ listId: "default", sortOrder: 8 });
  });

  it("imports overlapping requests once across multiple batches", async () => {
    const taskCount = 501;
    const text = Array.from({ length: taskCount }, (_, i) => `Task ${i}\n  Step ${i}`).join("\n");
    const document = parsePlainText(text, "Concurrent import");
    const results = await Promise.all([
      applyImport("owner", document),
      applyImport("owner", document),
    ]);

    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ listsCreated: 1, tasksImported: taskCount, tasksSkipped: 0, stepsImported: taskCount }),
      expect.objectContaining({ listsCreated: 0, tasksImported: 0, tasksSkipped: taskCount, stepsImported: 0 }),
    ]));
    expect(await prisma.list.count({ where: { ownerId: "owner", name: "Concurrent import" } })).toBe(1);
    expect(await prisma.task.count({ where: { createdById: "owner" } })).toBe(taskCount);
    expect(await prisma.subtask.count({ where: { task: { createdById: "owner" } } })).toBe(taskCount);
  });
});
