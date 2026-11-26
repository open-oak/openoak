import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createMcpHandler } from "mcp-handler";
import { createKanbanTestDatabase } from "../../../kanban/tests/helpers/database.mjs";
import { backfillOwner } from "../../../kanban/lib/kanban-migration.ts";
import { starterBoards } from "../../../kanban/lib/kanban-data.ts";
import { randomUUID } from "node:crypto";

let database;
let handler;
let boardKey;
let requestId = 0;
const board = structuredClone(starterBoards[0]);
board.tasks = Array.from({ length: 88 }, (_, index) => ({ ...structuredClone(board.tasks[0]), id: String(index), order: index, title: `Card ${index}`, description: '🌳\n"\\'.repeat(index === 0 ? 25000 : 1500) }));

before(async () => {
  database = await createKanbanTestDatabase();
  process.env.KANBAN_DATABASE_URL = database.url;
  process.env.KANBAN_DIRECT_URL = database.url;
  process.env.KANBAN_DATABASE_SCHEMA = database.schema;
  process.env.DATABASE_URL ||= database.url;
  await database.pool.query('INSERT INTO "KanbanDocument" ("userId","boards","activeBoardId") VALUES ($1,$2::jsonb,$3)', ["mcp-owner", JSON.stringify([board]), board.id]);
  await backfillOwner(database.pool, "mcp-owner");
  await backfillOwner(database.pool, "mcp-outsider");
  await database.pool.query('UPDATE "KanbanTransition" SET "storageMode"=$1,"compatibilityMirror"=false', ["modular"]);
  boardKey = (await database.pool.query('SELECT "boardKey" FROM "KanbanBoard" WHERE "ownerId"=$1', ["mcp-owner"])).rows[0].boardKey;
  const { registerOpenOakTools } = await import("../../lib/register-tools.ts");
  handler = createMcpHandler(registerOpenOakTools, { serverInfo: { name: "openoak-kanban-integration", version: "1" } });
});
after(async () => {
  const { kanbanPool } = await import("../../../kanban/lib/kanban-v2-db.ts");
  await kanbanPool().end();
  await database?.close();
});

async function call(name, args, userId = "mcp-owner", scopes = ["openoak:read"]) {
  const request = new Request("https://mcp.openoak.org", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "mcp-method": "tools/call", "mcp-name": name, "mcp-protocol-version": "2026-07-28" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method: "tools/call", params: { name, arguments: args, _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": { name: "kanban-integration", version: "1" },
    } } }),
  });
  // Inject authenticated middleware context; live OAuth is the KAN-06 gate.
  request.auth = { token: "test-only", clientId: "kanban-integration", scopes, extra: { userId, requestId: `read-${requestId}` } };
  const response = await handler(request);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(Buffer.byteLength(text) <= 65536, `actual MCP HTTP body: ${Buffer.byteLength(text)} bytes`);
  const payload = JSON.parse(text);
  assert.equal(payload.error, undefined, text);
  return payload.result;
}

test("actual MCP transport traverses 88 full cards with bounded detail and chunk envelopes", async () => {
  const boards = await call("kanban_v2_list_boards", {});
  assert.equal(boards.structuredContent.items[0].boardKey, boardKey);
  const lists = await call("kanban_v2_list_lists", { boardKey });
  assert.equal(lists.structuredContent.items.length, 3);
  const summaries = await call("kanban_v2_list_cards", { boardKey, limit: 2 });
  assert.equal(summaries.structuredContent.items[0].description, undefined);
  const received = [];
  let cursor;
  do {
    const result = await call("kanban_v2_read_card_details", { boardKey, limit: 50, ...(cursor ? { cursor } : {}) });
    assert.equal(result.isError, undefined);
    assert.ok(result.content[0].text.length < 100);
    for (const entry of result.structuredContent.items) {
      if (entry.kind === "card") received.push(entry.card);
      else {
        let next = entry.cursor;
        let json = "";
        do {
          const chunk = await call("kanban_v2_read_detail_chunk", { boardKey, id: entry.id, cursor: next });
          assert.equal(chunk.isError, undefined);
          json += chunk.structuredContent.jsonFragment;
          next = chunk.structuredContent.nextCursor;
        } while (next);
        received.push(JSON.parse(json));
      }
    }
    cursor = result.structuredContent.nextCursor;
  } while (cursor);
  assert.equal(received.length, 88);
  assert.deepEqual(received.map(({ id, title, description, order }) => ({ id, title, description, order })), board.tasks.map(({ id, title, description, order }) => ({ id, title, description, order })));
});

test("MCP enforces scope and ownership and returns restart_read for a stale detail cursor", async () => {
  const denied = await call("kanban_v2_get_card", { boardKey, id: "1" }, "mcp-outsider");
  assert.equal(denied.structuredContent.error.code, "not_found");
  const noScope = await call("kanban_v2_get_card", { boardKey, id: "1" }, "mcp-owner", []);
  assert.equal(noScope.structuredContent.error.code, "insufficient_scope");
  const first = await call("kanban_v2_get_card", { boardKey, id: "0" });
  await database.pool.query('UPDATE "KanbanCard" SET "contentVersion"="contentVersion"+1 WHERE "boardKey"=$1 AND "id"=$2', [boardKey, "0"]);
  const stale = await call("kanban_v2_read_detail_chunk", { boardKey, id: "0", cursor: first.structuredContent.result.cursor });
  assert.equal(stale.structuredContent.error.code, "restart_read");
});

test("MCP operations share atomic versions/receipts with web writes and report item conflicts", async () => {
  const operation = { contractVersion: 2, operationId: randomUUID(), epoch: 1, boardKey, type: "card.update", cardId: "1", expectedContentVersion: 1, changes: { title: "Changed through MCP" } };
  const result = await call("kanban_v2_apply_operation", { operation }, "mcp-owner", ["openoak:write"]);
  assert.equal(result.structuredContent.status, "applied");
  const duplicate = await call("kanban_v2_apply_operation", { operation }, "mcp-owner", ["openoak:write"]);
  assert.equal(duplicate.structuredContent.status, "duplicate");
  const stale = await call("kanban_v2_apply_operation", { operation: { ...operation, operationId: randomUUID(), changes: { title: "stale" } } }, "mcp-owner", ["openoak:write"]);
  assert.equal(stale.structuredContent.error.code, "conflict");
  const moved = await call("kanban_v2_apply_operation", { operation: { contractVersion: 2, operationId: randomUUID(), epoch: 1, boardKey, type: "card.move", cardId: "1", sourceListId: "todo", destinationListId: "doing", index: 0, expectedPlacementVersion: 1, expectedOrderVersions: { todo: 1, doing: 1 } } }, "mcp-owner", ["openoak:write"]);
  assert.equal(moved.structuredContent.status, "applied");
  const card = await call("kanban_v2_get_card", { boardKey, id: "1" });
  assert.equal(card.structuredContent.result.card.title, "Changed through MCP");
  assert.equal(card.structuredContent.result.card.listId, "doing");
  const changes = await call("kanban_v2_get_changes", { boardKey, sinceRevision: 1 });
  assert.ok(changes.structuredContent.items.length > 0);
});


test("MCP clients can create boards using only the catalog's public versions", async () => {
  const catalog = (await call("kanban_v2_list_boards", {})).structuredContent;
  const createdKey = randomUUID();
  const result = await call("kanban_v2_apply_operation", { operation: {
    contractVersion: 2, operationId: randomUUID(), epoch: catalog.epoch,
    boardKey: createdKey, id: randomUUID(), type: "board.create", name: "Public MCP create",
    expectedBoardOrderVersion: catalog.boardOrderVersion,
  } }, "mcp-owner", ["openoak:write"]);
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.status, "applied");
  const updated = (await call("kanban_v2_list_boards", {})).structuredContent;
  assert.equal(updated.boardOrderVersion, catalog.boardOrderVersion + 1);
  assert.ok(updated.items.some((item) => item.boardKey === createdKey));
});

test('shared-board MCP membership covers catalogue, chunks, writes, receipts and revocation', async () => {
  const {changeBoardSharing,getBoardSharing,acceptBoardInvite}=await import('../../../kanban/lib/kanban-sharing.ts');
  await changeBoardSharing('mcp-owner',boardKey,'enable',undefined,database.pool);
  await acceptBoardInvite('mcp-editor',(await getBoardSharing('mcp-owner',boardKey,database.pool)).invitePath.split('/').at(-1),database.pool);
  const catalog=(await call('kanban_v2_list_boards',{},'mcp-editor')).structuredContent;
  assert.equal(catalog.items.find(board=>board.boardKey===boardKey).accessLevel,'editor');
  const large=(await call('kanban_v2_get_card',{boardKey,id:'0'},'mcp-editor')).structuredContent.result;
  assert.equal(large.kind,'detail_required');
  const chunk=await call('kanban_v2_read_detail_chunk',{boardKey,id:'0',cursor:large.cursor},'mcp-editor');assert.equal(chunk.isError,undefined);
  const card=(await call('kanban_v2_get_card',{boardKey,id:'1'},'mcp-editor')).structuredContent.result.card;
  assert.equal(card.boardId,boardKey);
  const operation={contractVersion:2,operationId:randomUUID(),epoch:catalog.epoch,boardKey,type:'card.update',cardId:'1',expectedContentVersion:card.contentVersion,changes:{title:'Member MCP edit'}};
  assert.equal((await call('kanban_v2_apply_operation',{operation},'mcp-editor',['openoak:write'])).structuredContent.status,'applied');
  assert.equal((await call('kanban_v2_apply_operation',{operation},'mcp-editor',['openoak:write'])).structuredContent.status,'duplicate');
  const deletion={...operation,operationId:randomUUID(),type:'board.delete',expectedRevision:1};delete deletion.cardId;delete deletion.expectedContentVersion;delete deletion.changes;
  assert.equal((await call('kanban_v2_apply_operation',{operation:deletion},'mcp-editor',['openoak:write'])).structuredContent.error.code,'not_found');
  await changeBoardSharing('mcp-owner',boardKey,'remove','mcp-editor',database.pool);
  for(const [name,args,scopes] of [
    ['kanban_v2_get_card',{boardKey,id:'1'},['openoak:read']],
    ['kanban_v2_read_detail_chunk',{boardKey,id:'0',cursor:large.cursor},['openoak:read']],
    ['kanban_v2_get_changes',{boardKey,sinceRevision:1},['openoak:read']],
    ['kanban_v2_apply_operation',{operation},['openoak:write']],
  ]) assert.equal((await call(name,args,'mcp-editor',scopes)).structuredContent.error.code,'not_found');
  assert.equal((await call('kanban_v2_list_boards',{},'mcp-editor')).structuredContent.items.some(board=>board.boardKey===boardKey),false);
});


test("MCP deletion, Trash and restore use the shared recovery lifecycle", async () => {
  const cardId = "2";
  const before = (await call("kanban_v2_get_card", { boardKey, id: cardId })).structuredContent.result.card;
  const apply = operation => call("kanban_v2_apply_operation", { operation: { contractVersion: 2, operationId: randomUUID(), epoch: 1, boardKey, ...operation } }, "mcp-owner", ["openoak:write"]);
  assert.equal((await apply({ type: "card.delete", cardId, expectedContentVersion: before.contentVersion, expectedPlacementVersion: before.placementVersion })).structuredContent.status, "applied");
  const trash = await call("kanban_v2_list_trash", { boardKey });
  assert.equal(trash.isError, undefined);
  const entry = trash.structuredContent.items.find(card => card.id === cardId);
  assert.ok(entry.deletionId);
  assert.equal((await call("kanban_v2_list_trash", { boardKey }, "mcp-outsider")).structuredContent.error.code, "not_found");
  assert.equal((await call("kanban_v2_list_trash", { boardKey }, "mcp-owner", [])).structuredContent.error.code, "insufficient_scope");
  assert.equal((await apply({ type: "card.restore", cardId, deletionId: entry.deletionId })).structuredContent.status, "applied");
  const restored = (await call("kanban_v2_get_card", { boardKey, id: cardId })).structuredContent.result.card;
  assert.equal(restored.description, board.tasks.find(card => card.id === cardId).description);
  assert.equal(restored.contentVersion, 2);
});

 test("archive tools preserve long content, require membership and reject stale archive tokens", async () => {
  const cardId = "0";
  const apply = fields => call("kanban_v2_apply_operation", { operation: { contractVersion: 2, operationId: randomUUID(), epoch: 1, boardKey, ...fields } }, "mcp-owner", ["openoak:write"]);
  const current = (await database.pool.query('SELECT "contentVersion","placementVersion" FROM "KanbanCard" WHERE "boardKey"=$1 AND "id"=$2', [boardKey, cardId])).rows[0];
  const archived = await apply({ type: "card.archive", cardId, expectedContentVersion: current.contentVersion, expectedPlacementVersion: current.placementVersion });
  assert.equal(archived.structuredContent.status, "applied");
  const page = await call("kanban_v2_list_archive", { boardKey, query: "Card 0" });
  assert.equal(page.isError, undefined);
  const entry = page.structuredContent.items[0]; assert.equal(entry.id, cardId); assert.ok(entry.archivedAt);
  assert.equal((await call("kanban_v2_list_archive", { boardKey }, "mcp-outsider")).structuredContent.error.code, "not_found");
  assert.equal((await call("kanban_v2_get_card", { boardKey, id: cardId, archived: true }, "mcp-outsider")).structuredContent.error.code, "not_found");
  const full = await call("kanban_v2_get_card", { boardKey, id: cardId, archived: true });
  assert.equal(full.structuredContent.result.kind, "detail_required");
  let cursor = full.structuredContent.result.cursor, json = "";
  do {
    const chunk = await call("kanban_v2_read_detail_chunk", { boardKey, id: cardId, archived: true, cursor });
    assert.equal(chunk.isError, undefined); json += chunk.structuredContent.jsonFragment; cursor = chunk.structuredContent.nextCursor;
  } while (cursor);
  assert.equal(JSON.parse(json).description, board.tasks[0].description);
  assert.equal((await apply({ type: "card.restore", cardId, deletionId: entry.deletionId })).structuredContent.status, "applied");
  assert.equal((await apply({ type: "card.archive", cardId, expectedContentVersion: current.contentVersion + 1, expectedPlacementVersion: current.placementVersion + 1 })).structuredContent.status, "applied");
  assert.equal((await apply({ type: "card.purge", cardId, deletionId: entry.deletionId, confirmPermanent: true })).structuredContent.error.code, "conflict");
});
