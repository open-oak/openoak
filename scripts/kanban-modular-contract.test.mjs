import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cleanBoards } from "../apps/kanban/lib/kanban-data.ts";
import { boardReducer } from "../apps/kanban/lib/kanban-reducer.ts";
import { createKanbanBackup, parseKanbanBackup } from "../apps/kanban/lib/kanban-backup.ts";

// Test-only executable examples. This is deliberately not a repository, SQL
// migration, production validator, authorization service or API implementation.
const fixture = JSON.parse(readFileSync(new URL("../docs/fixtures/kanban-modular-contract.json", import.meta.url), "utf8"));
const MAX_BYTES = 65_536;
const clone = structuredClone;
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");
const fail = (message) => { throw new Error(message); };
const unique = (ids) => { if (new Set(ids).size !== ids.length) fail("ambiguous_identity"); };
const canonical = (value) => JSON.stringify(value, function (_key, item) {
  return item && !Array.isArray(item) && typeof item === "object"
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item;
});

function normalize(documents = fixture.documents, mappings = fixture.mappings) {
  const state = { boards: [], lists: [], cards: [], profiles: [], receipts: [] };
  for (const document of documents) {
    unique(document.boards.map((board) => board.id));
    for (const board of document.boards) {
      unique(board.lists.map((list) => list.id));
      unique(board.tasks.map((card) => card.id));
    }
    for (const board of cleanBoards(document.boards)) {
      const boardKey = mappings.find((m) => m.ownerId === document.ownerId && m.id === board.id)?.boardKey;
      if (!boardKey) fail("missing_mapping");
      const { lists, tasks, ...metadata } = board;
      state.boards.push({ ...metadata, ownerId: document.ownerId, boardKey,
        position: state.boards.filter((b) => b.ownerId === document.ownerId).length,
        metadataVersion: 1, listOrderVersion: 1, revision: 1, cardCount: tasks.length });
      lists.forEach((list, position) => state.lists.push({ ...list, boardKey, position,
        metadataVersion: 1, orderVersion: 1, cardCount: tasks.filter((c) => c.listId === list.id).length }));
      tasks.forEach(({ order, ...card }) => state.cards.push({ ...card, boardKey, position: order,
        contentVersion: 1, placementVersion: 1 }));
    }
    const owned = state.boards.filter((board) => board.ownerId === document.ownerId);
    state.profiles.push({ userId: document.ownerId,
      activeBoardKey: (owned.find((board) => board.id === document.activeBoardId) ?? owned[0]).boardKey,
      version: 1, boardOrderVersion: 1 });
  }
  unique(state.boards.map((board) => board.boardKey));
  return state;
}

function boardFor(state, actor, boardKey) {
  const board = state.boards.find((b) => b.boardKey === boardKey && b.ownerId === actor);
  if (!board) fail("not_found");
  return board;
}
function cardFor(state, boardKey, cardId) {
  const card = state.cards.find((c) => c.boardKey === boardKey && c.id === cardId);
  if (!card) fail("not_found");
  return card;
}
const cardsIn = (state, boardKey, listId) => state.cards
  .filter((c) => c.boardKey === boardKey && c.listId === listId).sort((a, b) => a.position - b.position);

function apply(original, actor, operation) {
  // All changes are made on a copy; any failed precondition leaves original intact.
  const state = clone(original);
  const board = boardFor(state, actor, operation.boardKey);
  const hash = canonical(operation);
  const receipt = state.receipts.find((r) => r.actor === actor && r.id === operation.operationId);
  if (receipt) {
    if (receipt.hash !== hash) fail("operation_id_reused");
    return { state, result: { ...receipt.result, status: "duplicate" } };
  }
  if (operation.contractVersion !== 2) fail("invalid");
  if (bytes(operation) > MAX_BYTES) fail("too_large");
  const listFor = (id) => {
    const list = state.lists.find((l) => l.boardKey === board.boardKey && l.id === id);
    if (!list) fail("not_found");
    return list;
  };
  const expect = (actual, expected) => { if (actual !== expected) fail("conflict"); };
  const reindex = (listId, cards) => cards.forEach((card, position) => {
    if (card.listId !== listId || card.position !== position) card.placementVersion++;
    card.listId = listId;
    card.position = position;
  });
  switch (operation.type) {
    case "card.update": {
      const card = cardFor(state, board.boardKey, operation.cardId);
      expect(card.contentVersion, operation.expectedContentVersion);
      const allowed = new Set(["title", "description", "dueDate", "color"]);
      if (!Object.keys(operation.changes).length || Object.keys(operation.changes).some((k) => !allowed.has(k))) fail("invalid");
      Object.assign(card, operation.changes);
      card.contentVersion++;
      break;
    }
    case "card.move": {
      const card = cardFor(state, board.boardKey, operation.cardId);
      expect(card.placementVersion, operation.expectedPlacementVersion);
      expect(card.listId, operation.sourceListId);
      const ids = [...new Set([card.listId, operation.destinationListId])];
      ids.forEach((id) => expect(listFor(id).orderVersion, operation.expectedOrderVersions[id]));
      const buckets = new Map(ids.map((id) => [id, cardsIn(state, board.boardKey, id).filter((c) => c.id !== card.id)]));
      const destination = buckets.get(operation.destinationListId);
      if (!Number.isInteger(operation.index) || operation.index < 0 || operation.index > destination.length) fail("invalid");
      destination.splice(operation.index, 0, card);
      for (const [id, cards] of buckets) {
        reindex(id, cards);
        Object.assign(listFor(id), { cardCount: cards.length, orderVersion: listFor(id).orderVersion + 1 });
      }
      break;
    }
    case "list.move": {
      expect(board.listOrderVersion, operation.expectedListOrderVersion);
      const list = listFor(operation.listId);
      const lists = state.lists.filter((l) => l.boardKey === board.boardKey && l.id !== list.id).sort((a, b) => a.position - b.position);
      if (!Number.isInteger(operation.index) || operation.index < 0 || operation.index > lists.length) fail("invalid");
      lists.splice(operation.index, 0, list);
      lists.forEach((entry, position) => { entry.position = position; });
      board.listOrderVersion++;
      break;
    }
    case "card.create": {
      const list = listFor(operation.listId);
      expect(list.orderVersion, operation.expectedOrderVersion);
      if (state.cards.some((c) => c.boardKey === board.boardKey && c.id === operation.cardId)) fail("conflict");
      state.cards.push({ id: operation.cardId, boardKey: board.boardKey, listId: list.id,
        title: operation.title, description: operation.description, dueDate: operation.dueDate,
        color: operation.color, position: list.cardCount, contentVersion: 1, placementVersion: 1 });
      list.cardCount++;
      list.orderVersion++;
      board.cardCount++;
      break;
    }
    case "card.delete": {
      const card = cardFor(state, board.boardKey, operation.cardId);
      expect(card.contentVersion, operation.expectedContentVersion);
      expect(card.placementVersion, operation.expectedPlacementVersion);
      const list = listFor(card.listId);
      state.cards = state.cards.filter((c) => c !== card);
      reindex(list.id, cardsIn(state, board.boardKey, list.id));
      list.cardCount--;
      list.orderVersion++;
      board.cardCount--;
      break;
    }
    default: fail("example_not_implemented");
  }
  board.revision++;
  const result = { operationId: operation.operationId, status: "applied", appliedRevision: board.revision };
  state.receipts.push({ actor, id: operation.operationId, boardKey: board.boardKey, hash, result });
  return { state, result };
}

function exportOwner(state, ownerId) {
  return state.boards.filter((b) => b.ownerId === ownerId).sort((a, b) => a.position - b.position).map((board) => {
    const lists = state.lists.filter((l) => l.boardKey === board.boardKey).sort((a, b) => a.position - b.position);
    return { id: board.id, name: board.name, theme: board.theme, wallpaper: board.wallpaper, wallpaperBlur: board.wallpaperBlur,
      lists: lists.map(({ id, name, color, icon }) => ({ id, name, color, icon })),
      tasks: lists.flatMap((list) => cardsIn(state, board.boardKey, list.id).map((card) => ({
        id: card.id, title: card.title, description: card.description, dueDate: card.dueDate,
        color: card.color, listId: card.listId, order: card.position,
      }))) };
  });
}

const envelope = (data) => ({ content: [{ type: "text", text: "Card details." }], structuredContent: data });
function detailPage(records, offset = 0) {
  const items = [];
  let index = offset;
  while (index < records.length && items.length < 50) {
    let entry = { kind: "card", card: records[index] };
    if (bytes(envelope({ items: [entry], nextCursor: index + 1 })) > MAX_BYTES) {
      entry = { kind: "detail_required", cursor: `example-record-${index}` };
    }
    if (bytes(envelope({ items: [...items, entry], nextCursor: index + 1 })) > MAX_BYTES) break;
    items.push(entry);
    index++;
  }
  if (index === offset && offset < records.length) fail("no_progress");
  return envelope({ items, nextCursor: index < records.length ? index : null });
}

function detailChunks(record) {
  const characters = Array.from(JSON.stringify(record));
  const output = [];
  let offset = 0;
  while (offset < characters.length) {
    let low = 1;
    let high = characters.length - offset;
    let fit = 0;
    const response = (length) => envelope({ jsonFragment: characters.slice(offset, offset + length).join(""),
      nextCursor: offset + length < characters.length ? offset + length : null });
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (bytes(response(middle)) <= MAX_BYTES) { fit = middle; low = middle + 1; }
      else high = middle - 1;
    }
    if (!fit) fail("no_progress");
    output.push(response(fit));
    offset += fit;
  }
  return output;
}

test("migration mapping preserves visible content, aliases, repeated IDs and blank drafts", () => {
  const state = normalize();
  assert.deepEqual(normalize(), state, "same persisted mappings make replay deterministic");
  for (const document of fixture.documents) assert.deepEqual(exportOwner(state, document.ownerId), cleanBoards(document.boards));
  assert.equal(state.cards.filter((c) => c.id === "1").length, 3);
  assert.equal(cardFor(state, "alice-main-key", "2").title, "");
  assert.equal(state.profiles[0].activeBoardKey, "alice-main-key");
});

test("duplicate identity within its scope blocks migration instead of dropping or renaming data", () => {
  for (const scope of ["board", "list", "card"]) {
    const documents = clone(fixture.documents);
    const owner = documents[0];
    const board = owner.boards[0];
    const records = scope === "board" ? owner.boards : scope === "list" ? board.lists : board.tasks;
    records.push(clone(records[0]));
    assert.throws(() => normalize(documents), /ambiguous_identity/);
  }
});

test("one-card edit changes no other card, list, board or personal selection", () => {
  const before = normalize();
  const { state } = apply(before, "alice", fixture.operations.update);
  assert.equal(cardFor(state, "alice-main-key", "1").title, "Prepare release");
  assert.equal(cardFor(state, "alice-main-key", "1").contentVersion, 2);
  assert.deepEqual(state.cards.filter((c) => !(c.boardKey === "alice-main-key" && c.id === "1")),
    before.cards.filter((c) => !(c.boardKey === "alice-main-key" && c.id === "1")));
  assert.deepEqual(state.lists, before.lists);
  assert.deepEqual(state.profiles, before.profiles);
  assert.deepEqual(state.boards.slice(1), before.boards.slice(1));
});

test("unrelated edits from the same base survive either commit order", () => {
  const run = (operations) => operations.reduce((s, op) => apply(s, "alice", op).state, normalize());
  const operations = [fixture.operations.update, fixture.operations.unrelated, fixture.operations.otherBoard];
  assert.deepEqual(run(operations).cards, run([...operations].reverse()).cards);
});

test("same-card stale content fails without partial changes or a receipt", () => {
  const state = apply(normalize(), "alice", fixture.operations.update).state;
  const before = clone(state);
  assert.throws(() => apply(state, "alice", { ...fixture.operations.update, operationId: "stale", changes: { title: "Stale overwrite" } }), /conflict/);
  assert.deepEqual(state, before);
});

test("card movement preserves edited text and agrees with current visible reducer ordering", () => {
  const before = apply(normalize(), "alice", fixture.operations.update).state;
  const state = apply(before, "alice", fixture.operations.move).state;
  for (const [listId, expected] of Object.entries(fixture.expectations.afterMove)) {
    assert.deepEqual(cardsIn(state, "alice-main-key", listId).map((c) => c.id), expected);
  }
  assert.equal(cardFor(state, "alice-main-key", "1").contentVersion, 2);
  const current = boardReducer({ boards: exportOwner(before, "alice"), activeBoardId: "main" },
    { type: "moveTaskToIndex", taskId: "1", listId: "doing", index: 1 });
  assert.deepEqual(exportOwner(state, "alice"), current.boards);
});

test("stale ordering fails rather than applying an old index to changed data", () => {
  const state = apply(normalize(), "alice", fixture.operations.create).state;
  assert.throws(() => apply(state, "alice", fixture.operations.move), /conflict/);
});

test("list reorder changes list positions without touching card content", () => {
  const before = normalize();
  const state = apply(before, "alice", fixture.operations.reorderList).state;
  const lists = state.lists.filter((l) => l.boardKey === "alice-main-key").sort((a, b) => a.position - b.position);
  assert.deepEqual(lists.map((l) => l.id), fixture.expectations.afterListMove);
  assert.deepEqual(state.cards, before.cards);
});

test("a lost create response can be replayed without duplicate cards, counters or revisions", () => {
  const first = apply(normalize(), "alice", fixture.operations.create);
  const retry = apply(first.state, "alice", fixture.operations.create);
  assert.equal(retry.result.status, "duplicate");
  assert.equal(retry.result.appliedRevision, first.result.appliedRevision);
  assert.deepEqual(retry.state, first.state);
});

test("receipt replay is authorized and binds the entire payload", () => {
  const first = apply(normalize(), "alice", fixture.operations.update);
  assert.throws(() => apply(first.state, "alice", { ...fixture.operations.update, changes: { title: "Different" } }), /operation_id_reused/);
  assert.throws(() => apply(first.state, "bob", fixture.operations.update), /not_found/);
});

test("a deleted card's retry uses its receipt before resolving the absent card", () => {
  const first = apply(normalize(), "alice", fixture.operations.delete);
  const retry = apply(first.state, "alice", fixture.operations.delete);
  assert.deepEqual(retry.state, first.state);
  assert.equal(retry.result.status, "duplicate");
});

test("88 full descriptions fit count- and byte-bounded pages without gaps", () => {
  const records = Array.from({ length: 88 }, (_, i) => ({ id: String(i), description: "detail ".repeat(250) }));
  let offset = 0;
  const seen = [];
  do {
    const page = detailPage(records, offset);
    assert.ok(bytes(page) <= MAX_BYTES);
    assert.ok(page.structuredContent.items.length <= 50);
    seen.push(...page.structuredContent.items.map((entry) => entry.card));
    offset = page.structuredContent.nextCursor;
  } while (offset !== null);
  assert.deepEqual(seen, records);
});

test("oversized escape-heavy Unicode detail is signposted and reconstructed exactly", () => {
  const record = { id: "large", description: "🌳\u0000\n\"".repeat(20_000) };
  const page = detailPage([record]);
  assert.equal(page.structuredContent.items[0].kind, "detail_required");
  const chunks = detailChunks(record);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(bytes(chunk) <= MAX_BYTES);
  assert.deepEqual(JSON.parse(chunks.map((c) => c.structuredContent.jsonFragment).join("")), record);
});

test("an oversized mutation is rejected without changing data or recording success", () => {
  const state = normalize();
  const before = clone(state);
  const operation = { ...fixture.operations.update, changes: { description: "\u0000".repeat(20_000) } };
  assert.ok(bytes(operation) > MAX_BYTES, "JSON escaping counts toward the request budget");
  assert.throws(() => apply(state, "alice", operation), /too_large/);
  assert.deepEqual(state, before);
});

test("rollback snapshot includes post-cutover edits and round-trips the existing backup format", () => {
  const state = apply(normalize(), "alice", fixture.operations.update).state;
  const document = fixture.documents[0];
  const snapshot = { boards: exportOwner(state, "alice"), activeBoardId: document.activeBoardId,
    revision: document.revision + 1 };
  assert.equal(snapshot.revision, fixture.expectations.rollback.compatibilityRevision);
  assert.equal(snapshot.boards[0].tasks[0].title, fixture.expectations.rollback.title);
  assert.notDeepEqual(snapshot.boards, cleanBoards(document.boards));
  const backup = parseKanbanBackup(createKanbanBackup(snapshot.boards, snapshot.activeBoardId));
  assert.deepEqual(cleanBoards(backup.boards), snapshot.boards);
  assert.equal(backup.activeBoardId, snapshot.activeBoardId);
  assert.deepEqual(exportOwner(state, "bob"), cleanBoards(fixture.documents[1].boards));
});
