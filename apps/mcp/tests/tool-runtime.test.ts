import assert from "node:assert/strict";
import test from "node:test";

import { runTool } from "../lib/tool-runtime";

function context(scopes: string[]) {
  return {
    http: {
      authInfo: {
        token: "not-logged",
        clientId: "client-1",
        scopes,
        expiresAt: Math.floor(Date.now() / 1_000) + 60,
        extra: { userId: "user-1", requestId: "request-1" },
      },
    },
  } as never;
}

test("enforces write scope before invoking a mutation", async () => {
  let called = false;
  const result = await runTool(
    "outline_update_note",
    "openoak:write",
    context(["openoak:read"]),
    async () => {
      called = true;
      return {};
    },
    () => "updated",
  );
  assert.equal(called, false);
  assert.equal(result.isError, true);
  const structured = result.structuredContent as { error: { code: string } };
  assert.equal(structured.error.code, "insufficient_scope");
});

test("returns structured content while logs remain content-free", async () => {
  const lines: string[] = [];
  const originalInfo = console.info;
  console.info = (...values: unknown[]) => lines.push(values.join(" "));
  try {
    const result = await runTool(
      "outline_create_note",
      "openoak:write",
      context(["openoak:write"]),
      async (userId) => ({ id: "note-1", title: "private title", body: "private body", userId }),
      () => "Created note note-1.",
    );
    assert.equal(result.isError, undefined);
    assert.equal((result.structuredContent as { id: string }).id, "note-1");
    assert.equal(result.content[0].type, "text");
    assert.equal(result.content[0].type === "text" ? result.content[0].text : "", "Created note note-1.");
  } finally {
    console.info = originalInfo;
  }
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /private title|private body|note-1/);
  assert.deepEqual(Object.keys(JSON.parse(lines[0])).sort(), ["durationMs", "outcome", "requestId", "toolName"]);
});

test("preserves safe conflict details without exposing unexpected errors", async () => {
  const conflict = await runTool(
    "todo_update_task",
    "openoak:write",
    context(["openoak:write"]),
    async () => {
      throw Object.assign(new Error("The task changed after it was read."), {
        code: "conflict",
        details: { currentUpdatedAt: "2026-08-13T10:00:00.000Z" },
      });
    },
    () => "updated",
  );
  assert.equal((conflict.structuredContent as { error: { code: string } }).error.code, "conflict");

  const unexpected = await runTool(
    "todo_get_task",
    "openoak:read",
    context(["openoak:read"]),
    async () => {
      throw new Error("database password appeared here");
    },
    () => "read",
  );
  assert.equal(
    (unexpected.structuredContent as { error: { message: string } }).error.message,
    "The OpenOak operation could not be completed.",
  );
  assert.doesNotMatch(JSON.stringify(unexpected), /database password/);
});
