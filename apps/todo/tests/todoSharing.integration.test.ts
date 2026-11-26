import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const activeUser = vi.hoisted(() => ({ id: "owner" }));

vi.mock("@/lib/auth", () => ({
  ensureTodoProfile: async () => ({ id: activeUser.id }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let prisma: (typeof import("@/lib/prisma"))["prisma"];
let bulkCopyTasksToList: (typeof import("@/app/actions"))["bulkCopyTasksToList"];
let bulkMoveTasksToList: (typeof import("@/app/actions"))["bulkMoveTasksToList"];
let moveTaskToList: (typeof import("@/app/actions"))["moveTaskToList"];
let setDueDate: (typeof import("@/app/actions"))["setDueDate"];
let toggleImportant: (typeof import("@/app/actions"))["toggleImportant"];
let toggleMyDay: (typeof import("@/app/actions"))["toggleMyDay"];
let toggleTask: (typeof import("@/app/actions"))["toggleTask"];
let acceptTodoInviteClaimsForUser: (typeof import("@/lib/todo-sharing-service"))["acceptTodoInviteClaimsForUser"];
let configureListInviteForOwner: (typeof import("@/lib/todo-sharing-service"))["configureListInviteForOwner"];
let leaveTodoList: (typeof import("@/lib/todo-sharing-service"))["leaveTodoList"];
let removeListMemberForOwner: (typeof import("@/lib/todo-sharing-service"))["removeListMemberForOwner"];
let editableListWhere: (typeof import("@/lib/todo-access"))["editableListWhere"];
let projectPersonalTaskFlags: (typeof import("@/lib/todo-access"))["projectPersonalTaskFlags"];
let readableListWhere: (typeof import("@/lib/todo-access"))["readableListWhere"];
let readableTaskWhere: (typeof import("@/lib/todo-access"))["readableTaskWhere"];

const integration = describe.runIf(Boolean(process.env.TODO_INTEGRATION_DATABASE_URL));

async function seed() {
  await prisma.todoProfile.createMany({
    data: [
      { id: "owner", displayName: "Owner", email: "owner@example.test" },
      { id: "editor", displayName: "Editor", email: "editor@example.test" },
      { id: "outsider", displayName: "Outsider", email: "outsider@example.test" },
    ],
  });
  const defaultList = await prisma.list.create({ data: { id: "default", name: "Tasks", ownerId: "owner", kind: "DEFAULT" } });
  const customList = await prisma.list.create({ data: { id: "custom", name: "Project", ownerId: "owner", kind: "CUSTOM" } });
  return { defaultList, customList };
}

integration("Todo sharing service against migrated Postgres", () => {
  beforeAll(async () => {
    ({ prisma } = await import("@/lib/prisma"));
    const actions = await import("@/app/actions");
    bulkCopyTasksToList = actions.bulkCopyTasksToList;
    bulkMoveTasksToList = actions.bulkMoveTasksToList;
    moveTaskToList = actions.moveTaskToList;
    setDueDate = actions.setDueDate;
    toggleImportant = actions.toggleImportant;
    toggleMyDay = actions.toggleMyDay;
    toggleTask = actions.toggleTask;
    const sharing = await import("@/lib/todo-sharing-service");
    acceptTodoInviteClaimsForUser = sharing.acceptTodoInviteClaimsForUser;
    configureListInviteForOwner = sharing.configureListInviteForOwner;
    leaveTodoList = sharing.leaveTodoList;
    removeListMemberForOwner = sharing.removeListMemberForOwner;
    const access = await import("@/lib/todo-access");
    editableListWhere = access.editableListWhere;
    projectPersonalTaskFlags = access.projectPersonalTaskFlags;
    readableListWhere = access.readableListWhere;
    readableTaskWhere = access.readableTaskWhere;
  });

  beforeEach(async () => {
    activeUser.id = "owner";
    await prisma.todoProfile.deleteMany();
  });

  afterAll(async () => {
    await prisma.todoProfile.deleteMany();
    await prisma.$disconnect();
  });

  it("creates stable custom-list invites, rotates them, disables them, and rejects default lists", async () => {
    await seed();
    const enabled = await configureListInviteForOwner("custom", "owner", "enable");
    expect(enabled?.inviteEnabled).toBe(true);
    expect(enabled?.inviteNonce).toBeTruthy();
    const repeated = await configureListInviteForOwner("custom", "owner", "enable");
    expect(repeated?.inviteNonce).toBe(enabled?.inviteNonce);
    const rotated = await configureListInviteForOwner("custom", "owner", "rotate");
    expect(rotated?.inviteNonce).not.toBe(enabled?.inviteNonce);
    const disabled = await configureListInviteForOwner("custom", "owner", "disable");
    expect(disabled).toMatchObject({ inviteEnabled: false, inviteNonce: null });
    expect(await configureListInviteForOwner("default", "owner", "enable")).toBeNull();
    expect(await configureListInviteForOwner("custom", "editor", "enable")).toBeNull();
  });

  it("accepts only a current enabled nonce and is idempotent for owner and editor", async () => {
    await seed();
    const enabled = await configureListInviteForOwner("custom", "owner", "enable");
    const claims = { nonce: enabled!.inviteNonce! };
    await expect(acceptTodoInviteClaimsForUser(claims, "owner")).resolves.toEqual({ listId: "custom", accessLevel: "owner" });
    const results = await Promise.all(Array.from({ length: 8 }, () => acceptTodoInviteClaimsForUser(claims, "editor")));
    expect(results.every((result) => result?.accessLevel === "editor")).toBe(true);
    expect(await prisma.listMember.count({ where: { listId: "custom", userId: "editor" } })).toBe(1);
    expect(await prisma.listMember.count({ where: { listId: "custom", userId: "owner" } })).toBe(0);

    const rotated = await configureListInviteForOwner("custom", "owner", "rotate");
    await expect(acceptTodoInviteClaimsForUser(claims, "outsider")).resolves.toBeNull();
    await expect(acceptTodoInviteClaimsForUser({ nonce: rotated!.inviteNonce! }, "outsider"))
      .resolves.toEqual({ listId: "custom", accessLevel: "editor" });
    await configureListInviteForOwner("custom", "owner", "disable");
    await expect(acceptTodoInviteClaimsForUser({ nonce: rotated!.inviteNonce! }, "editor"))
      .resolves.toBeNull();
  });

  it("enforces owner-only removal and editor-only leave without owner transfer", async () => {
    await seed();
    const enabled = await configureListInviteForOwner("custom", "owner", "enable");
    const claims = { nonce: enabled!.inviteNonce! };
    await acceptTodoInviteClaimsForUser(claims, "editor");
    await acceptTodoInviteClaimsForUser(claims, "outsider");

    await expect(removeListMemberForOwner("custom", "editor", "outsider")).resolves.toBe(false);
    await expect(removeListMemberForOwner("custom", "owner", "owner")).resolves.toBe(false);
    await expect(removeListMemberForOwner("custom", "owner", "outsider")).resolves.toBe(true);
    expect(await prisma.listMember.count({ where: { listId: "custom", userId: "outsider" } })).toBe(0);
    await expect(leaveTodoList("custom", "owner")).resolves.toBe(false);
    await expect(leaveTodoList("custom", "editor")).resolves.toBe(true);
    await expect(leaveTodoList("custom", "editor")).resolves.toBe(false);
    expect(await prisma.list.findUnique({ where: { id: "custom" }, select: { ownerId: true } })).toEqual({ ownerId: "owner" });
  });

  it("keeps default lists private at both query and database layers", async () => {
    await seed();
    await expect(prisma.listMember.create({ data: { listId: "default", userId: "editor" } })).rejects.toThrow();
    await prisma.listMember.create({ data: { listId: "custom", userId: "editor" } });
    expect((await prisma.list.findMany({ where: readableListWhere("editor"), orderBy: { id: "asc" }, select: { id: true } })).map((row) => row.id))
      .toEqual(["custom"]);
    expect((await prisma.list.findMany({ where: editableListWhere("outsider"), select: { id: true } }))).toEqual([]);
  });

  it("projects creator and collaborator personal flags independently", async () => {
    await seed();
    await prisma.listMember.create({ data: { listId: "custom", userId: "editor" } });
    const task = await prisma.task.create({
      data: {
        id: "task",
        title: "Shared task",
        listId: "custom",
        createdById: "owner",
        isImportant: true,
        isMyDay: true,
        personalStates: { create: { userId: "owner", isImportant: true, isMyDay: true } },
      },
    });
    expect(projectPersonalTaskFlags({ ...task, personalStates: [] }, "editor")).toMatchObject({ isImportant: false, isMyDay: false });
    await prisma.taskPersonalState.create({ data: { taskId: task.id, userId: "editor", isImportant: true, isMyDay: false } });
    const editorRow = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      include: { personalStates: { where: { userId: "editor" } } },
    });
    expect(projectPersonalTaskFlags(editorRow, "editor")).toMatchObject({ isImportant: true, isMyDay: false });
  });

  it("applies shared fields and personal flags through the editor action boundary", async () => {
    const { customList } = await seed();
    await prisma.listMember.create({ data: { listId: customList.id, userId: "editor" } });
    const task = await prisma.task.create({
      data: {
        id: "shared-action-task",
        title: "Shared action task",
        listId: customList.id,
        createdById: "owner",
        isImportant: false,
        isMyDay: false,
        personalStates: { create: { userId: "owner", isImportant: false, isMyDay: false } },
      },
    });

    activeUser.id = "editor";
    await toggleTask(task.id, true);
    await setDueDate(task.id, new Date("2026-09-10T00:00:00.000Z"));
    await toggleImportant(task.id, true);
    await toggleMyDay(task.id, true);

    const updated = await prisma.task.findUniqueOrThrow({
      where: { id: task.id },
      include: { personalStates: { orderBy: { userId: "asc" } } },
    });
    expect(updated).toMatchObject({
      isCompleted: true,
      isImportant: false,
      isMyDay: false,
      createdById: "owner",
    });
    expect(updated.dueDate?.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(updated.personalStates).toEqual([
      expect.objectContaining({ userId: "editor", isImportant: true, isMyDay: true }),
      expect.objectContaining({ userId: "owner", isImportant: false, isMyDay: false }),
    ]);
  });

  it("moves and copies across owned/shared audiences without copying memberships or another user's flags", async () => {
    const { customList } = await seed();
    const editorDefault = await prisma.list.create({
      data: { id: "editor-default", name: "Tasks", ownerId: "editor", kind: "DEFAULT" },
    });
    await prisma.listMember.create({ data: { listId: customList.id, userId: "editor" } });
    const source = await prisma.task.create({
      data: {
        id: "copy-source",
        title: "Copy source",
        notes: "Shared notes",
        listId: customList.id,
        createdById: "owner",
        isImportant: false,
        isMyDay: true,
        personalStates: {
          create: [
            { userId: "owner", isImportant: false, isMyDay: true },
            { userId: "editor", isImportant: true, isMyDay: false },
          ],
        },
        subtasks: { create: { title: "Shared subtask", sortOrder: 3 } },
      },
    });
    await prisma.task.createMany({
      data: [
        { id: "bulk-one", title: "Bulk one", listId: customList.id, createdById: "owner" },
        { id: "bulk-two", title: "Bulk two", listId: customList.id, createdById: "owner" },
      ],
    });

    activeUser.id = "editor";
    await bulkCopyTasksToList([source.id], editorDefault.id);
    const copied = await prisma.task.findFirstOrThrow({
      where: { listId: editorDefault.id, title: source.title },
      include: { personalStates: true, subtasks: true },
    });
    expect(copied).toMatchObject({
      createdById: "editor",
      isImportant: true,
      isMyDay: false,
      notes: "Shared notes",
    });
    expect(copied.personalStates).toEqual([
      expect.objectContaining({ userId: "editor", isImportant: true, isMyDay: false }),
    ]);
    expect(copied.subtasks).toEqual([
      expect.objectContaining({ title: "Shared subtask", sortOrder: 3 }),
    ]);
    expect(await prisma.listMember.count({ where: { listId: editorDefault.id } })).toBe(0);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: source.id }, select: { listId: true } }))
      .toEqual({ listId: customList.id });

    activeUser.id = "outsider";
    await moveTaskToList(source.id, editorDefault.id);
    expect(await prisma.task.findUniqueOrThrow({ where: { id: source.id }, select: { listId: true } }))
      .toEqual({ listId: customList.id });

    activeUser.id = "editor";
    await moveTaskToList(source.id, editorDefault.id);
    await bulkMoveTasksToList(["bulk-one", "bulk-two"], editorDefault.id);
    expect(await prisma.task.findMany({
      where: { id: { in: [source.id, "bulk-one", "bulk-two"] } },
      orderBy: { id: "asc" },
      select: { id: true, listId: true, createdById: true },
    })).toEqual([
      { id: "bulk-one", listId: editorDefault.id, createdById: "owner" },
      { id: "bulk-two", listId: editorDefault.id, createdById: "owner" },
      { id: source.id, listId: editorDefault.id, createdById: "owner" },
    ]);
    expect(await prisma.task.count({ where: { id: source.id, ...readableTaskWhere("owner") } })).toBe(0);
  });
});
