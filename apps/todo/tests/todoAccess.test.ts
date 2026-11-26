import { describe, expect, it } from "vitest";
import {
  projectPersonalTaskFlags,
  resolveListAccess,
} from "../lib/todo-access";

describe("Todo collaboration access", () => {
  const custom = { ownerId: "owner", kind: "CUSTOM" as const, memberIds: ["editor"] };

  it("separates owner, editor, outsider, and removed-member access", () => {
    expect(resolveListAccess(custom, "owner")).toBe("owner");
    expect(resolveListAccess(custom, "editor")).toBe("editor");
    expect(resolveListAccess(custom, "outsider")).toBeNull();
    expect(resolveListAccess({ ...custom, memberIds: [] }, "editor")).toBeNull();
  });

  it("never shares a default list", () => {
    expect(resolveListAccess({ ...custom, kind: "DEFAULT" }, "editor")).toBeNull();
  });

  it("does not authorize from creator identity", () => {
    expect(resolveListAccess({ ownerId: "other", kind: "CUSTOM", memberIds: [] }, "creator")).toBeNull();
  });

  it("uses the same ID-based policy in self-hosted deployments", () => {
    const selfHosted = { ownerId: "local-owner", kind: "CUSTOM" as const, memberIds: ["local-editor"] };
    expect(resolveListAccess(selfHosted, "local-owner")).toBe("owner");
    expect(resolveListAccess(selfHosted, "local-editor")).toBe("editor");
    expect(resolveListAccess(selfHosted, "local-outsider")).toBeNull();
  });

  it("applies one owner/editor matrix to every shared-content operation", () => {
    const contentOperations = [
      "read",
      "create-task",
      "rename-list",
      "restyle-list",
      "edit-task",
      "complete-task",
      "set-due-date",
      "edit-notes",
      "edit-subtask",
      "reorder",
      "bulk-edit",
    ];
    for (const operation of contentOperations) {
      expect(resolveListAccess(custom, "owner"), operation).toBe("owner");
      expect(resolveListAccess(custom, "editor"), operation).toBe("editor");
      expect(resolveListAccess(custom, "outsider"), operation).toBeNull();
      expect(resolveListAccess({ ...custom, memberIds: [] }, "editor"), operation).toBeNull();
    }
  });

  it("keeps access management and final list deletion owner-only", () => {
    const access = resolveListAccess(custom, "editor");
    expect(access === "owner").toBe(false);
    expect(resolveListAccess(custom, "owner") === "owner").toBe(true);
  });

  it("projects private flags per user with a creator-only legacy fallback", () => {
    const task = {
      id: "task",
      createdById: "owner",
      isImportant: true,
      isMyDay: true,
      personalStates: [] as Array<{ isImportant: boolean; isMyDay: boolean }>,
    };
    expect(projectPersonalTaskFlags(task, "owner")).toMatchObject({ isImportant: true, isMyDay: true });
    expect(projectPersonalTaskFlags(task, "editor")).toMatchObject({ isImportant: false, isMyDay: false });
    expect(projectPersonalTaskFlags({ ...task, personalStates: [{ isImportant: false, isMyDay: true }] }, "editor"))
      .toMatchObject({ isImportant: false, isMyDay: true });
  });
});
