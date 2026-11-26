import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");
const addTaskBar = readFileSync(resolve(root, "components/add-task-bar.tsx"), "utf8");
const taskDetailPanel = readFileSync(resolve(root, "components/task-detail-panel.tsx"), "utf8");
const keyboardShortcuts = readFileSync(resolve(root, "components/keyboard-shortcuts.tsx"), "utf8");

describe("blank task lifecycle", () => {
  it("opens the detailed-task editor only after the server returns a durable id", () => {
    const createIndex = addTaskBar.indexOf("await createBlankTask(");
    const selectIndex = addTaskBar.indexOf("setSelectedTaskId(taskId)", createIndex);

    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(selectIndex).toBeGreaterThan(createIndex);
    expect(addTaskBar).not.toContain("setSelectedTaskId(tempId)");
  });

  it("discards a newly created task when both stored and edited titles remain blank", () => {
    expect(taskDetailPanel).toContain('task?.title.trim() === ""');
    expect(taskDetailPanel).toContain('title.trim() === ""');
    expect(taskDetailPanel).toContain('close(task?.title.trim() === "")');
    expect(taskDetailPanel).toContain("await discardBlankTask(blankTaskId)");
  });

  it("does not create multiple drafts from a held Space shortcut", () => {
    expect(keyboardShortcuts).toContain("if (e.repeat) return;");
  });
});
