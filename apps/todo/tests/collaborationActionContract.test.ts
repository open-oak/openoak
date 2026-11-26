import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const actions = readFileSync(resolve(process.cwd(), "app/actions.ts"), "utf8");
const mcp = readFileSync(resolve(process.cwd(), "lib/mcp.ts"), "utf8");

function exportedFunction(source: string, name: string) {
  const marker = `export async function ${name}`;
  const start = source.indexOf(marker);
  expect(start, `${name} must remain exported`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\nexport async function ", start + marker.length);
  return source.slice(start, next < 0 ? undefined : next);
}

describe("collaboration action wiring", () => {
  it("routes every UI task mutation family through shared edit authorization", () => {
    const contracts: Record<string, RegExp> = {
      toggleTask: /updateTaskContent/,
      toggleImportant: /setPersonalFlags/,
      updateTask: /updateTaskContent/,
      deleteTask: /editableTaskWhere/,
      addSubtask: /editableTaskWhere/,
      toggleSubtask: /updateSubtaskContent/,
      updateSubtask: /updateSubtaskContent/,
      deleteSubtask: /editableSubtaskWhere/,
      setDueDate: /updateTaskContent/,
      toggleMyDay: /setPersonalFlags/,
      moveTaskToList: /editableTaskWhere[\s\S]*editableListWhere/,
      bulkAddTasksToMyDay: /setBulkPersonalFlag/,
      bulkRemoveTasksFromMyDay: /setBulkPersonalFlag/,
      bulkCompleteTasks: /updateBulkTaskContent/,
      bulkUncompleteTasks: /updateBulkTaskContent/,
      bulkMarkTasksImportant: /setBulkPersonalFlag/,
      bulkUnmarkTasksImportant: /setBulkPersonalFlag/,
      bulkMoveTasksToList: /editableListWhere[\s\S]*editableTaskWhere/,
      bulkCopyTasksToList: /editableListWhere[\s\S]*readableTaskWhere/,
      bulkDeleteTasks: /editableTaskWhere/,
      reorderTasks: /editableTaskWhere/,
      createBlankTask: /editableListWhere/,
      discardBlankTask: /editableTaskWhere/,
    };
    for (const [name, contract] of Object.entries(contracts)) {
      expect(exportedFunction(actions, name), name).toMatch(contract);
    }
  });

  it("allows list presentation edits but keeps final list deletion owner-only", () => {
    for (const name of ["updateList", "updateTheme", "updateBackground"]) {
      expect(exportedFunction(actions, name), name).toContain("editableListWhere");
    }
    expect(exportedFunction(actions, "deleteList")).toMatch(/ownerId: user\.id, kind: "CUSTOM"/);
  });

  it("uses the same readable/editable boundary in every MCP family", () => {
    for (const name of ["todoListTasks", "todoGetTask"]) {
      expect(exportedFunction(mcp, name), name).toContain("readableTaskWhere");
    }
    for (const name of ["todoCreateTask", "todoUpdateTask", "todoDeleteTask"]) {
      expect(exportedFunction(mcp, name), name).toMatch(/editable(List|Task)Where/);
    }
    for (const name of ["todoCreateSubtask", "todoUpdateSubtask", "todoDeleteSubtask"]) {
      expect(exportedFunction(mcp, name), name).toMatch(/editable(Task|Subtask)Where/);
    }
    expect(exportedFunction(mcp, "todoDeleteList")).toMatch(/ownerId: userId, kind: "CUSTOM"/);
  });

  it("never authorizes task or subtask access through creator identity", () => {
    for (const source of [actions, mcp]) {
      const creatorWhereLines = source
        .split("\n")
        .filter((line) => line.includes("where:") && line.includes("createdById:"));
      expect(creatorWhereLines).toEqual([]);
    }
  });
});
