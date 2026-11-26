import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTodoExport } from "@/lib/todo-export";

describe("createTodoExport", () => {
  it("creates a dated, versioned OpenTodo document", () => {
    const data = {
      settings: { themeColor: "blue" },
      lists: [{ id: "list-1", name: "Tasks", tasks: [] }],
      sharedPersonalStates: [],
    };
    const text = createTodoExport(data, new Date("2026-08-12T09:30:00.000Z"));

    expect(JSON.parse(text)).toEqual({
      format: "opentodo",
      version: 2,
      exportedAt: "2026-08-12T09:30:00.000Z",
      ...data,
    });
  });
});

const mocks = {
  ensureTodoProfile: vi.fn(),
  listFindMany: vi.fn(),
  personalStateFindMany: vi.fn(),
};

vi.doMock("@/lib/auth", () => ({
  ensureTodoProfile: mocks.ensureTodoProfile,
}));

vi.doMock("@/lib/prisma", () => ({
  prisma: {
    list: { findMany: mocks.listFindMany },
    taskPersonalState: { findMany: mocks.personalStateFindMany },
  },
}));

const route = await import("@/app/api/export/route");

describe("OpenTodo export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureTodoProfile.mockResolvedValue({
      id: "user-1",
      themeColor: "blue",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-08-12T00:00:00.000Z"),
    });
    mocks.listFindMany.mockResolvedValue([
      { id: "list-1", name: "Tasks", tasks: [] },
    ]);
    mocks.personalStateFindMany.mockResolvedValue([]);
  });

  it("exports only the authenticated user's lists and tasks", async () => {
    const response = await route.GET();
    const document = await response.json();
    const query = mocks.listFindMany.mock.calls[0][0];

    expect(query.where).toEqual({ ownerId: "user-1" });
    expect(query.select.tasks.where).toBeUndefined();
    expect(document.settings).not.toHaveProperty("id");
    expect(document.lists).toEqual([{ id: "list-1", name: "Tasks", tasks: [] }]);
    expect(document.sharedPersonalStates).toEqual([]);
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="opentodo-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
