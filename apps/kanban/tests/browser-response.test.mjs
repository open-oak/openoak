import assert from "node:assert/strict";
import test from "node:test";
import { KanbanBrowserApi } from "../lib/kanban-browser-api.ts";
import { kanbanV2ReadSchemas } from "../lib/kanban-v2-schemas.ts";

test("read responses tolerate additive fields but validate known fields and strict requests", async () => {
  let payload = { epoch: 1, accountKey: "account", activeBoardKey: "board", boardOrderVersion: 1, version: 1, futureField: true };
  const api = new KanbanBrowserApi(async (_path, init) => {
    assert.equal(new Headers(init.headers).get("x-openkanban-capabilities"), "sharing");
    return Response.json(payload);
  });
  assert.equal((await api.read("profile")).futureField, undefined);
  payload.version = "invalid";
  await assert.rejects(api.read("profile"), { code: "invalid_response" });
  assert.equal(kanbanV2ReadSchemas.boards.input.safeParse({ futureField: true }).success, false);
});

test("network, server and incompatible response failures are distinct", async () => {
  for (const [request, code] of [
    [async () => { throw new TypeError("Failed to fetch"); }, "offline"],
    [async () => new Response("Gateway error", { status: 503 }), "unavailable"],
    [async () => Response.json(null, { status: 401 }), "unavailable"],
    [async () => new Response("not JSON"), "invalid_response"],
    [async () => Response.json({ epoch: "bad" }), "invalid_response"],
  ]) await assert.rejects(new KanbanBrowserApi(request).read("profile"), { code });
});
