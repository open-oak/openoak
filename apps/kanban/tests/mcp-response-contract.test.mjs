import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../lib/mcp.ts"), "utf8");

test("Kanban MCP reads separate bounded board, card-list, and card-detail contracts", () => {
  assert.match(source, /function serializeBoardSummary[\s\S]*?cardCount:[\s\S]*?lists:/);
  assert.match(source, /export async function kanbanListCards[\s\S]*?descriptionExcerpt/);
  assert.match(source, /export async function kanbanGetCard[\s\S]*?serializeTask/);
  const getBoard = source.slice(source.indexOf("export async function kanbanGetBoard"), source.indexOf("export async function kanbanListCards"));
  assert.doesNotMatch(getBoard, /tasks:/);
});

test("Kanban mutations return compact revision metadata, never the saved document", () => {
  const mutate = source.slice(source.indexOf("async function mutateDocument"), source.indexOf("export async function kanbanListBoards"));
  assert.match(mutate, /\.\.\.mutation\.result/);
  assert.match(mutate, /revision: saved\.revision/);
  assert.doesNotMatch(mutate, /boards: saved|document: saved|state: saved/);
});
