import type { McpServer, ServerContext, ToolAnnotations } from "@modelcontextprotocol/server";
import { listV2Boards, listV2Lists, listV2Cards, getV2Card, readV2CardDetails, readV2DetailChunk, getV2Changes, listV2Trash, listV2Archive, kanbanV2ReadSchemas, KANBAN_V2_SUMMARY, applyKanbanOperation, kanbanOperationSchema, kanbanOperationResultSchema } from "@openoak/kanban/mcp-v2";
import {
  kanbanCreateBoard,
  kanbanCreateCard,
  kanbanCreateList,
  kanbanDeleteBoard,
  kanbanDeleteCard,
  kanbanDeleteList,
  kanbanGetCard,
  kanbanGetBoard,
  kanbanListCards,
  kanbanListBoards,
  kanbanMoveCard,
  kanbanSearch,
  kanbanUpdateBoard,
  kanbanUpdateCard,
  kanbanUpdateList,
} from "@openoak/kanban/mcp";
import {
  outlineCreateFolder,
  outlineCreateNote,
  outlineDeleteFolder,
  outlineDeleteNote,
  outlineGetNote,
  outlineListFolders,
  outlineListNotes,
  outlineUpdateFolder,
  outlineUpdateNote,
} from "@openoak/outline/mcp";
import {
  todoCreateList,
  todoCreateSubtask,
  todoCreateTask,
  todoDeleteList,
  todoDeleteSubtask,
  todoDeleteTask,
  todoGetTask,
  todoListLists,
  todoListTasks,
  todoUpdateList,
  todoUpdateSubtask,
  todoUpdateTask,
} from "@openoak/todo/mcp";
import { z } from "zod";
import {
  createAnnotations,
  deleteAnnotations,
  readAnnotations,
  runTool,
  updateAnnotations,
  type OpenOakScope,
} from "./tool-runtime";

export const OPENOAK_WRITE_TOOL_NAMES = new Set([
  "outline_create_folder",
  "outline_update_folder",
  "outline_delete_folder",
  "outline_create_note",
  "outline_update_note",
  "outline_delete_note",
  "kanban_create_board",
  "kanban_update_board",
  "kanban_delete_board",
  "kanban_create_list",
  "kanban_update_list",
  "kanban_delete_list",
  "kanban_create_card",
  "kanban_update_card",
  "kanban_move_card",
  "kanban_delete_card",
  "todo_create_list",
  "todo_update_list",
  "todo_delete_list",
  "todo_create_task",
  "todo_update_task",
  "todo_delete_task",
  "todo_create_subtask",
  "todo_update_subtask",
  "todo_delete_subtask",
]);

export function isWriteToolName(name: string) {
  return OPENOAK_WRITE_TOOL_NAMES.has(name);
}

const id = z.string().trim().min(1).max(500).describe("Opaque OpenOak ID.");
const cursor = z.string().min(1).max(500).optional().describe("Opaque cursor returned by the previous page.");
const folderFilterId = id.nullable().optional().describe("Folder ID, null for unfiled Notes, or omitted for all notes.");
const createFolderId = id.nullable().optional().describe("Folder ID, or null/omitted to create the note in unfiled Notes.");
const updateFolderId = id.nullable().optional().describe("Folder ID to move the note, null to unfile it, or omitted to leave its folder unchanged.");
const limit = z.number().int().min(1).max(50).default(20).describe("Page size; defaults to 20 and never exceeds 50.");
const expectedUpdatedAt = z.string().datetime({ offset: true }).describe("Exact updatedAt value returned by the last read.");
const expectedRevision = z.number().int().nonnegative().describe("Exact Kanban document revision returned by the last read.");
const nullableText = (maximum: number) => z.string().max(maximum).nullable();
const isoTimestamp = z.string().datetime({ offset: true });
const url = z.string().url();
const nextPage = { nextCursor: z.string().optional() };
const folderSummary = z.object({
  id,
  name: z.string(),
  noteCount: z.number().int().nonnegative(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
}).strict();
const noteFolder = z.object({ id, name: z.string() }).strict().nullable();
const noteSummary = z.object({
  id,
  title: z.string(),
  excerpt: z.string().max(240),
  color: z.string(),
  sortOrder: z.number().int(),
  folder: noteFolder,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  url,
}).strict();
const noteDetail = noteSummary.omit({ excerpt: true }).extend({ body: z.string() }).strict();
const compactEntityWrite = z.object({ id, updatedAt: isoTimestamp, url }).strict();
const compactFolderWrite = z.object({ id, updatedAt: isoTimestamp }).strict();
const deletion = z.object({ id, deleted: z.boolean(), alreadyAbsent: z.boolean() }).strict();
const kanbanList = z.object({
  id,
  name: z.string(),
  color: z.string(),
  icon: z.string(),
  cardCount: z.number().int().nonnegative(),
}).strict();
const kanbanBoardListItem = z.object({
  id,
  name: z.string(),
  listCount: z.number().int().nonnegative(),
  cardCount: z.number().int().nonnegative(),
  theme: z.string(),
  updatedAt: isoTimestamp.nullable(),
  revision: z.number().int().nonnegative(),
  url,
}).strict();
const kanbanBoardSummary = z.object({
  id,
  name: z.string(),
  theme: z.string(),
  wallpaper: z.string(),
  wallpaperBlur: z.boolean(),
  cardCount: z.number().int().nonnegative(),
  lists: z.array(kanbanList),
  url,
}).strict();
const cardColor = z.enum(["green", "yellow", "red"]).nullable();
const kanbanCardSummary = z.object({
  id,
  title: z.string(),
  descriptionExcerpt: z.string().max(240),
  dueDate: z.string(),
  color: cardColor,
  listId: id,
  boardId: id,
  order: z.number().int().nonnegative(),
  url,
}).strict();
const kanbanCardDetail = kanbanCardSummary.omit({ descriptionExcerpt: true }).extend({ description: z.string() }).strict();
const kanbanMutationBase = {
  id,
  revision: z.number().int().nonnegative(),
  updatedAt: isoTimestamp.nullable(),
};
const todoListSummary = z.object({
  id,
  name: z.string(),
  themeColor: z.string().nullable(),
  backgroundImage: z.string().nullable(),
  sortOrder: z.number().int(),
  kind: z.enum(["DEFAULT", "CUSTOM"]),
  accessLevel: z.enum(["owner", "editor"]),
  ownerDisplay: z.string(),
  shared: z.boolean(),
  memberCount: z.number().int().nonnegative().optional(),
  taskCount: z.number().int().nonnegative().optional(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  url,
}).strict();
const todoSubtask = z.object({
  id,
  title: z.string(),
  isCompleted: z.boolean(),
  taskId: id,
  sortOrder: z.number().int(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
}).strict();
const todoTaskCompact = z.object({
  id,
  title: z.string(),
  noteExcerpt: z.string().max(240),
  dueDate: isoTimestamp.nullable(),
  isCompleted: z.boolean(),
  isImportant: z.boolean(),
  isMyDay: z.boolean(),
  sortOrder: z.number().int(),
  listId: id,
  createdById: id,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  url,
  subtaskCount: z.number().int().nonnegative(),
  completedSubtaskCount: z.number().int().nonnegative(),
}).strict();
const todoTaskDetail = todoTaskCompact.omit({ noteExcerpt: true, subtaskCount: true, completedSubtaskCount: true }).extend({
  notes: z.string().nullable(),
  subtasks: z.array(todoSubtask),
}).strict();

export const OPENOAK_OUTPUT_SCHEMAS = {
  openoak_connection_status: z.object({
    status: z.literal("connected"),
    serviceVersion: z.string(),
    scopes: z.array(z.enum(["openoak:read", "openoak:write"])),
    products: z.array(z.enum(["outline", "kanban", "todo"])),
  }).strict(),
  openoak_search: z.object({
    query: z.string(),
    count: z.number().int().nonnegative(),
    items: z.array(z.object({
      product: z.enum(["outline", "kanban", "todo"]),
      type: z.string(),
      id,
      title: z.string(),
      excerpt: z.string().max(240).optional(),
      updatedAt: isoTimestamp.optional(),
      folder: noteFolder.optional(),
      listId: id.optional(),
      boardId: id.optional(),
      url,
    }).strict()),
  }).strict(),
  outline_list_folders: z.object({ items: z.array(folderSummary) }).strict(),
  outline_create_folder: compactFolderWrite,
  outline_update_folder: compactFolderWrite,
  outline_delete_folder: deletion.extend({ movedNoteCount: z.number().int().nonnegative() }).strict(),
  outline_list_notes: z.object({ items: z.array(noteSummary), ...nextPage }).strict(),
  outline_get_note: noteDetail,
  outline_create_note: compactEntityWrite,
  outline_update_note: compactEntityWrite,
  outline_delete_note: deletion,
  kanban_v2_list_boards: kanbanV2ReadSchemas.boards.output,
  kanban_v2_list_lists: kanbanV2ReadSchemas.lists.output,
  kanban_v2_list_cards: kanbanV2ReadSchemas.cards.output,
  kanban_v2_get_card: kanbanV2ReadSchemas.card.output,
  kanban_v2_read_card_details: kanbanV2ReadSchemas["card-details"].output,
  kanban_v2_read_detail_chunk: kanbanV2ReadSchemas["detail-chunks"].output,
  kanban_v2_get_changes: kanbanV2ReadSchemas.changes.output,
  kanban_v2_list_archive: kanbanV2ReadSchemas.archive.output,
  kanban_v2_list_trash: kanbanV2ReadSchemas.trash.output,
  kanban_v2_apply_operation: kanbanOperationResultSchema,
  kanban_list_boards: z.object({ items: z.array(kanbanBoardListItem), revision: z.number().int().nonnegative(), ...nextPage }).strict(),
  kanban_get_board: z.object({ board: kanbanBoardSummary, revision: z.number().int().nonnegative(), updatedAt: isoTimestamp.nullable() }).strict(),
  kanban_list_cards: z.object({ items: z.array(kanbanCardSummary), revision: z.number().int().nonnegative(), updatedAt: isoTimestamp.nullable(), ...nextPage }).strict(),
  kanban_get_card: z.object({ card: kanbanCardDetail, revision: z.number().int().nonnegative(), updatedAt: isoTimestamp.nullable() }).strict(),
  kanban_create_board: z.object({ ...kanbanMutationBase, created: z.boolean(), url }).strict(),
  kanban_update_board: z.object({ ...kanbanMutationBase, updated: z.boolean(), url }).strict(),
  kanban_delete_board: z.object({ ...kanbanMutationBase, deleted: z.boolean(), alreadyAbsent: z.boolean(), resetToMain: z.boolean().optional() }).strict(),
  kanban_create_list: z.object({ ...kanbanMutationBase, boardId: id, created: z.boolean(), url }).strict(),
  kanban_update_list: z.object({ ...kanbanMutationBase, boardId: id, updated: z.boolean(), url }).strict(),
  kanban_delete_list: z.object({ ...kanbanMutationBase, boardId: id, deleted: z.boolean(), alreadyAbsent: z.boolean(), movedCardCount: z.number().int().nonnegative().optional() }).strict(),
  kanban_create_card: z.object({ ...kanbanMutationBase, boardId: id, listId: id, created: z.boolean(), url }).strict(),
  kanban_update_card: z.object({ ...kanbanMutationBase, boardId: id, updated: z.boolean(), url }).strict(),
  kanban_move_card: z.object({ ...kanbanMutationBase, boardId: id, listId: id, moved: z.boolean(), url }).strict(),
  kanban_delete_card: z.object({ ...kanbanMutationBase, boardId: id, deleted: z.boolean(), alreadyAbsent: z.boolean() }).strict(),
  todo_list_lists: z.object({ items: z.array(todoListSummary), ...nextPage }).strict(),
  todo_create_list: compactEntityWrite,
  todo_update_list: compactEntityWrite,
  todo_delete_list: deletion.extend({ deletedTaskCount: z.number().int().nonnegative(), deletedSubtaskCount: z.number().int().nonnegative() }).strict(),
  todo_list_tasks: z.object({ items: z.array(todoTaskCompact), ...nextPage }).strict(),
  todo_get_task: todoTaskDetail,
  todo_create_task: compactEntityWrite.extend({ listId: id }).strict(),
  todo_update_task: compactEntityWrite.extend({ listId: id }).strict(),
  todo_delete_task: deletion.extend({ deletedSubtaskCount: z.number().int().nonnegative() }).strict(),
  todo_create_subtask: z.object({ id, taskId: id, updatedAt: isoTimestamp }).strict(),
  todo_update_subtask: z.object({ id, taskId: id, updatedAt: isoTimestamp }).strict(),
  todo_delete_subtask: deletion,
} as const;

export type OpenOakToolName = keyof typeof OPENOAK_OUTPUT_SCHEMAS;
function summaryCount(result: Record<string, unknown>, singular: string, plural = `${singular}s`) {
  const count = Array.isArray(result.items) ? result.items.length : typeof result.count === "number" ? result.count : 0;
  return `${count} ${count === 1 ? singular : plural}.`;
}

function register<T extends z.ZodRawShape>(
  server: McpServer,
  name: OpenOakToolName,
  title: string,
  description: string,
  inputSchema: z.ZodObject<T>,
  annotations: ToolAnnotations,
  requiredScope: OpenOakScope,
  operation: (userId: string, input: z.output<z.ZodObject<T>>, context: ServerContext) => Promise<unknown>,
  summarize: (result: Record<string, unknown>) => string,
) {
  server.registerTool(
    name,
    { title, description, inputSchema, outputSchema: OPENOAK_OUTPUT_SCHEMAS[name], annotations },
    async (input, context: ServerContext) => runTool(
      name,
      requiredScope,
      context,
      (userId) => operation(userId, input, context),
      summarize,
    ),
  );
}

function noteExcerpt(body: string) {
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_>#\[\]()~-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function fairMerge<T>(groups: T[][], maximum: number) {
  const result: T[] = [];
  for (let index = 0; result.length < maximum; index += 1) {
    let added = false;
    for (const group of groups) {
      if (group[index] !== undefined) {
        result.push(group[index]);
        added = true;
        if (result.length === maximum) break;
      }
    }
    if (!added) break;
  }
  return result;
}

function compactEntityMutation(result: { id: string; updatedAt: string; url: string }) {
  return { id: result.id, updatedAt: result.updatedAt, url: result.url };
}

function compactFolderMutation(result: { id: string; updatedAt: string }) {
  return { id: result.id, updatedAt: result.updatedAt };
}

function compactTaskMutation(result: { id: string; listId: string; updatedAt: string; url: string }) {
  return { ...compactEntityMutation(result), listId: result.listId };
}

function compactSubtaskMutation(result: { id: string; taskId: string; updatedAt: string }) {
  return { id: result.id, taskId: result.taskId, updatedAt: result.updatedAt };
}

function compactTodoTask(task: Record<string, unknown>) {
  const subtasks = Array.isArray(task.subtasks) ? task.subtasks as Array<{ isCompleted?: boolean }> : [];
  const notes = task.notes;
  const summary = { ...task };
  delete summary.notes;
  delete summary.subtasks;
  return {
    ...summary,
    noteExcerpt: typeof notes === "string" ? noteExcerpt(notes) : "",
    subtaskCount: subtasks.length,
    completedSubtaskCount: subtasks.filter((subtask) => subtask.isCompleted).length,
  };
}

export function registerOpenOakTools(server: McpServer) {
  register(
    server,
    "openoak_connection_status",
    "Check OpenOak connection",
    "Confirm that the authenticated OpenOak connection is active and show only its granted OpenOak scopes and available products. Returns no account identity or private content.",
    z.object({}).strict(),
    readAnnotations,
    "openoak:read",
    async (_userId, _input, context) => ({
      status: "connected" as const,
      serviceVersion: process.env.VERCEL_GIT_COMMIT_SHA || process.env.npm_package_version || "0.1.0",
      scopes: (context.http?.authInfo?.scopes || []).filter((scope): scope is "openoak:read" | "openoak:write" =>
        scope === "openoak:read" || scope === "openoak:write"
      ),
      products: ["outline", "kanban", "todo"] as const,
    }),
    () => "OpenOak is connected.",
  );

  register(
    server,
    "openoak_search",
    "Search OpenOak",
    "Bounded keyword search across the authenticated user's Outline notes, Kanban boards/lists/cards, and Todo tasks. This is literal keyword search, not semantic search.",
    z.object({ query: z.string().trim().min(1).max(200), limit }).strict(),
    readAnnotations,
    "openoak:read",
    async (userId, input) => {
      const [outline, kanban, todo] = await Promise.all([
        outlineListNotes(userId, { query: input.query, limit: input.limit }),
        kanbanSearch(userId, input.query, input.limit),
        todoListTasks(userId, { query: input.query, limit: input.limit }),
      ]);
      const outlineItems = outline.items.map((note) => ({
          product: "outline",
          type: "note",
          id: note.id,
          title: note.title,
          excerpt: noteExcerpt(note.body),
          updatedAt: note.updatedAt,
          folder: note.folder,
          url: note.url,
        }));
      const kanbanItems = kanban.map(({ description, ...item }) => ({
          product: "kanban",
          ...item,
          ...(typeof description === "string" ? { excerpt: description.slice(0, 240) } : {}),
        }));
      const todoItems = todo.items.map((task) => ({
          product: "todo",
          type: "task",
          id: task.id,
          title: task.title,
          excerpt: task.notes?.slice(0, 240) ?? "",
          updatedAt: task.updatedAt,
          listId: task.listId,
          url: task.url,
        }));
      const items = fairMerge([outlineItems, kanbanItems, todoItems], input.limit);
      return { query: input.query, items, count: items.length };
    },
    (result) => summaryCount(result, "match", "matches"),
  );

  register(
    server,
    "outline_list_folders",
    "List Outline folders",
    "List the authenticated user's flat note folders with note counts.",
    z.object({}).strict(),
    readAnnotations,
    "openoak:read",
    (userId) => outlineListFolders(userId),
    (result) => summaryCount(result, "folder"),
  );
  register(
    server,
    "outline_create_folder",
    "Create Outline folder",
    "Create a flat folder for organizing Outline notes.",
    z.object({ name: z.string().trim().min(1).max(80) }).strict(),
    createAnnotations,
    "openoak:write",
    async (userId, input) => compactFolderMutation(await outlineCreateFolder(userId, input)),
    (result) => `Created folder ${String(result.id)}.`,
  );
  register(
    server,
    "outline_update_folder",
    "Update Outline folder",
    "Rename an owned Outline folder. Requires expectedUpdatedAt and rejects stale changes.",
    z.object({ id, expectedUpdatedAt, name: z.string().trim().min(1).max(80) }).strict(),
    updateAnnotations,
    "openoak:write",
    async (userId, input) => compactFolderMutation(await outlineUpdateFolder(userId, input)),
    (result) => `Updated folder ${String(result.id)}.`,
  );
  register(
    server,
    "outline_delete_folder",
    "Delete Outline folder",
    "Delete an owned folder and safely move its notes back to unfiled Notes. Requires expectedUpdatedAt.",
    z.object({ id, expectedUpdatedAt }).strict(),
    deleteAnnotations,
    "openoak:write",
    (userId, input) => outlineDeleteFolder(userId, input),
    (result) => result.alreadyAbsent ? "The folder was already absent." : `Deleted folder ${String(result.id)} and unfiled ${String(result.movedNoteCount)} notes.`,
  );
  register(
    server,
    "outline_list_notes",
    "List Outline notes",
    "List or keyword-filter the authenticated user's notes. Bodies are returned as canonical Markdown excerpts; use outline_get_note for the complete body.",
    z.object({ query: z.string().trim().max(200).optional(), folderId: folderFilterId, limit, cursor }).strict(),
    readAnnotations,
    "openoak:read",
    async (userId, input) => {
      const page = await outlineListNotes(userId, input);
      return {
        ...page,
        items: page.items.map(({ body, ...note }) => ({ ...note, excerpt: noteExcerpt(body) })),
      };
    },
    (result) => summaryCount(result, "note"),
  );
  register(
    server,
    "outline_get_note",
    "Get Outline note",
    "Get one owned Outline note, including its complete canonical Markdown body and concurrency timestamp.",
    z.object({ id }).strict(),
    readAnnotations,
    "openoak:read",
    (userId, input) => outlineGetNote(userId, input.id as string),
    (result) => `Read note ${String(result.id)}.`,
  );
  register(
    server,
    "outline_create_note",
    "Create Outline note",
    "Create an Outline note. The body is stored as unprefixed canonical Markdown.",
    z.object({
      title: z.string().max(160).optional(),
      body: z.string().max(80_000).optional(),
      color: z.enum(["default", "green", "blue", "purple", "coral", "gold"]).optional(),
      folderId: createFolderId,
    }).strict(),
    createAnnotations,
    "openoak:write",
    async (userId, input) => compactEntityMutation(await outlineCreateNote(userId, input)),
    (result) => `Created note ${String(result.id)}.`,
  );
  register(
    server,
    "outline_update_note",
    "Update Outline note",
    "Update fields on an owned Outline note. Requires expectedUpdatedAt and returns a conflict instead of overwriting a newer edit.",
    z.object({
      id,
      expectedUpdatedAt,
      title: z.string().max(160).optional(),
      body: z.string().max(80_000).optional(),
      color: z.enum(["default", "green", "blue", "purple", "coral", "gold"]).optional(),
      folderId: updateFolderId,
    }).strict(),
    updateAnnotations,
    "openoak:write",
    async (userId, input) => compactEntityMutation(await outlineUpdateNote(userId, input as Parameters<typeof outlineUpdateNote>[1])),
    (result) => `Updated note ${String(result.id)}.`,
  );
  register(
    server,
    "outline_delete_note",
    "Delete Outline note",
    "Permanently delete an owned Outline note. Requires expectedUpdatedAt; repeating a completed deletion is safe.",
    z.object({ id, expectedUpdatedAt }).strict(),
    deleteAnnotations,
    "openoak:write",
    (userId, input) => outlineDeleteNote(userId, input as Parameters<typeof outlineDeleteNote>[1]),
    (result) => result.alreadyAbsent ? "The note was already absent." : `Deleted note ${String(result.id)}.`,
  );

  register(
    server,
    "kanban_v2_list_boards",
    "List modular Kanban boards",
    "Read bounded board summaries and stable board keys. Cursors restart explicitly if records change. Available after this account's modular cutover.",
    kanbanV2ReadSchemas.boards.input, readAnnotations, "openoak:read", (userId, input) => listV2Boards(userId, input),
    () => KANBAN_V2_SUMMARY,
  );
  register(
    server,
    "kanban_v2_list_lists",
    "List modular Kanban lists",
    "Read bounded list metadata, ordering versions and counts for one authorized board without card content.",
    kanbanV2ReadSchemas.lists.input, readAnnotations, "openoak:read", (userId, input) => listV2Lists(userId, input),
    () => KANBAN_V2_SUMMARY,
  );
  register(
    server,
    "kanban_v2_list_cards",
    "List modular Kanban cards",
    "Read compact card summaries for one board with optional list, keyword and ID filters. Does not read the account aggregate. Use detail pages for complete descriptions.",
    kanbanV2ReadSchemas.cards.input, readAnnotations, "openoak:read", (userId, input) => listV2Cards(userId, input),
    () => KANBAN_V2_SUMMARY,
  );
  register(
    server,
    "kanban_v2_get_card",
    "Get modular Kanban card",
    "Read one complete card with independent content and placement versions. Set archived=true for an archived card; use the same flag for detail chunks. An oversized legacy card returns detail_required; follow its cursor with kanban_v2_read_detail_chunk.",
    kanbanV2ReadSchemas.card.input, readAnnotations, "openoak:read", (userId, input) => getV2Card(userId, input),
    () => KANBAN_V2_SUMMARY,
  );
  register(
    server,
    "kanban_v2_read_card_details",
    "Read complete Kanban card details",
    "Read up to 50 complete cards, bounded by response bytes as well as count. Follow nextCursor until absent. Resolve detail_required entries with detail chunks; descriptions are never silently truncated. Restart from the first page on restart_read.",
    kanbanV2ReadSchemas["card-details"].input, readAnnotations, "openoak:read", (userId, input) => readV2CardDetails(userId, input),
    () => KANBAN_V2_SUMMARY,
  );
  register(
    server,
    "kanban_v2_read_detail_chunk",
    "Read oversized Kanban detail chunk",
    "Follow the cursor for one oversized legacy card. Concatenate jsonFragment strings in sequence and parse the completed JSON. Reauthorization and card versions are checked on every chunk; restart_read means discard the old partial result.",
    kanbanV2ReadSchemas["detail-chunks"].input, readAnnotations, "openoak:read", (userId, input) => readV2DetailChunk(userId, input),
    () => KANBAN_V2_SUMMARY,
  );
  register(
    server,
    "kanban_v2_get_changes",
    "Read modular Kanban changes",
    "Read bounded identity/deletion markers since a board revision, or continue a large operation's refreshCursor. Refetch affected items through detail/list reads. Restart a stale page cursor.",
    kanbanV2ReadSchemas.changes.input, readAnnotations, "openoak:read", (userId, input) => getV2Changes(userId, input),
    () => KANBAN_V2_SUMMARY,
  );
  register(
    server,
    "kanban_v2_list_archive",
    "Search archived Kanban cards",
    "Read paginated archived cards, optionally searching title and content with query. Read a complete archived card with kanban_v2_get_card archived=true, and pass archived=true for its detail chunks. Restore with card.restore and the current deletionId; choose destinationListId when needed. Only the owner can permanently delete using card.purge with confirmPermanent=true.",
    kanbanV2ReadSchemas.archive.input, readAnnotations, "openoak:read", (userId, input) => listV2Archive(userId, input),
    () => KANBAN_V2_SUMMARY,
  );
  register(
    server,
    "kanban_v2_list_trash",
    "Read archived Kanban cards (compatibility)",
    "Compatibility alias for archive reads. New clients should use kanban_v2_list_archive. Use deletionId with card.restore or owner-only card.purge. Restore appends to the original list, or the first remaining list when the original is gone. Board deletion also permanently removes its archive.",
    kanbanV2ReadSchemas.trash.input, readAnnotations, "openoak:read", (userId, input) => listV2Trash(userId, input),
    () => KANBAN_V2_SUMMARY,
  );
  register(
    server,
    "kanban_v2_apply_operation",
    "Apply modular Kanban operation",
    "Apply one strictly validated board/list/card operation with a stable operationId and the epoch/item versions from v2 reads. Retry the exact same payload/ID after a lost response. Changed payloads need new IDs; conflicts never overwrite unseen edits. card.archive retains a card in Archive indefinitely; card.delete is a compatibility alias for archiving; card.restore requires its current deletionId. card.purge permanently deletes an archived card and requires the owner plus confirmPermanent=true. archive.purge deletes all archived cards atomically for the owner with confirmPermanent=true and the expectedRevision from an unfiltered archive read; a changed board rejects the deletion. Board deletion remains permanent, including its archive. Profile selection is web-only.",
    z.object({ operation: kanbanOperationSchema.refine((operation) => operation.type !== "profile.selectBoard", "Profile selection is web-only.") }).strict(),
    deleteAnnotations, "openoak:write", (userId, input) => applyKanbanOperation(userId, input.operation),
    () => KANBAN_V2_SUMMARY,
  );
  register(
    server,
    "kanban_list_boards",
    "List Kanban boards",
    "List owned Kanban boards with counts, stable links, and the document revision required by mutations.",
    z.object({ limit, cursor }).strict(),
    readAnnotations,
    "openoak:read",
    (userId, input) => kanbanListBoards(userId, input),
    (result) => summaryCount(result, "board"),
  );
  register(
    server,
    "kanban_get_board",
    "Get Kanban board",
    "Get one owned Kanban board with metadata, list summaries, card counts, and the document revision required by mutations. Use kanban_list_cards and kanban_get_card for card content.",
    z.object({ id }).strict(),
    readAnnotations,
    "openoak:read",
    (userId, input) => kanbanGetBoard(userId, input.id as string),
    (result) => `Read board ${String((result.board as Record<string, unknown> | undefined)?.id ?? "")}.`,
  );
  register(
    server,
    "kanban_list_cards",
    "List Kanban cards",
    "List compact Kanban card summaries with optional board, list, and keyword filters. Use kanban_get_card for a complete description.",
    z.object({
      boardId: id.optional(),
      listId: id.optional(),
      query: z.string().trim().max(200).optional(),
      limit,
      cursor,
    }).strict(),
    readAnnotations,
    "openoak:read",
    (userId, input) => kanbanListCards(userId, input),
    (result) => summaryCount(result, "card"),
  );
  register(
    server,
    "kanban_get_card",
    "Get Kanban card",
    "Get one complete Kanban card and the document revision required by mutations.",
    z.object({ boardId: id, id }).strict(),
    readAnnotations,
    "openoak:read",
    (userId, input) => kanbanGetCard(userId, input.boardId as string, input.id as string),
    (result) => `Read card ${String((result.card as Record<string, unknown> | undefined)?.id ?? "")}.`,
  );
  register(
    server,
    "kanban_create_board",
    "Create Kanban board",
    "Create a board using document-level compare-and-swap. Pass the exact expectedRevision from the latest Kanban read.",
    z.object({ name: z.string().trim().min(1).max(160), expectedRevision }).strict(),
    createAnnotations,
    "openoak:write",
    (userId, input) => kanbanCreateBoard(userId, input as Parameters<typeof kanbanCreateBoard>[1]),
    (result) => `Created board ${String(result.id)}.`,
  );
  register(
    server,
    "kanban_update_board",
    "Update Kanban board",
    "Update board name or appearance using document-level compare-and-swap. Stale revisions are rejected.",
    z.object({
      id,
      expectedRevision,
      name: z.string().trim().min(1).max(160).optional(),
      theme: z.enum(["default", "blue", "purple", "coral", "green", "gold"]).optional(),
      wallpaper: z.enum(["none", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]).optional(),
      wallpaperBlur: z.boolean().optional(),
    }).strict(),
    updateAnnotations,
    "openoak:write",
    (userId, input) => kanbanUpdateBoard(userId, input as Parameters<typeof kanbanUpdateBoard>[1]),
    (result) => `Updated board ${String(result.id)}.`,
  );
  register(
    server,
    "kanban_delete_board",
    "Delete Kanban board",
    "Permanently delete a board using document-level compare-and-swap. Deleting the final board resets it to an empty Main board; repeating a completed deletion is safe.",
    z.object({ id, expectedRevision }).strict(),
    deleteAnnotations,
    "openoak:write",
    (userId, input) => kanbanDeleteBoard(userId, input as Parameters<typeof kanbanDeleteBoard>[1]),
    (result) => result.alreadyAbsent ? "The board was already absent." : `Deleted board ${String(result.id)}.`,
  );

  register(
    server,
    "kanban_create_list",
    "Create Kanban list",
    "Create a list on a board using document-level compare-and-swap.",
    z.object({
      boardId: id,
      expectedRevision,
      name: z.string().trim().min(1).max(160),
      color: z.enum(["default", "blue", "purple", "coral", "green", "gold"]).optional(),
      icon: z.enum(["circle", "clock", "check", "flag", "briefcase", "star", "calendar", "todo"]).optional(),
    }).strict(),
    createAnnotations,
    "openoak:write",
    (userId, input) => kanbanCreateList(userId, input as Parameters<typeof kanbanCreateList>[1]),
    (result) => `Created list ${String(result.id)}.`,
  );
  register(
    server,
    "kanban_update_list",
    "Update Kanban list",
    "Update a board list using document-level compare-and-swap. Stale revisions are rejected.",
    z.object({
      boardId: id,
      id,
      expectedRevision,
      name: z.string().trim().min(1).max(160).optional(),
      color: z.enum(["default", "blue", "purple", "coral", "green", "gold"]).optional(),
      icon: z.enum(["circle", "clock", "check", "flag", "briefcase", "star", "calendar", "todo"]).optional(),
    }).strict(),
    updateAnnotations,
    "openoak:write",
    (userId, input) => kanbanUpdateList(userId, input as Parameters<typeof kanbanUpdateList>[1]),
    (result) => `Updated list ${String(result.id)}.`,
  );
  register(
    server,
    "kanban_delete_list",
    "Delete Kanban list",
    "Permanently delete a board list using compare-and-swap. Its cards move to the first remaining list; the final list cannot be deleted; repeating a completed deletion is safe.",
    z.object({ boardId: id, id, expectedRevision }).strict(),
    deleteAnnotations,
    "openoak:write",
    (userId, input) => kanbanDeleteList(userId, input as Parameters<typeof kanbanDeleteList>[1]),
    (result) => result.alreadyAbsent ? "The list was already absent." : `Deleted list ${String(result.id)}.`,
  );

  register(
    server,
    "kanban_create_card",
    "Create Kanban card",
    "Create a card in a board list using document-level compare-and-swap.",
    z.object({
      boardId: id,
      listId: id,
      expectedRevision,
      title: z.string().trim().min(1).max(500),
      description: z.string().max(20_000).optional(),
      dueDate: z.string().max(100).optional(),
      color: z.enum(["green", "yellow", "red"]).nullable().optional(),
    }).strict(),
    createAnnotations,
    "openoak:write",
    (userId, input) => kanbanCreateCard(userId, input as Parameters<typeof kanbanCreateCard>[1]),
    (result) => `Created card ${String(result.id)}.`,
  );
  register(
    server,
    "kanban_update_card",
    "Update Kanban card",
    "Update card fields using document-level compare-and-swap. Use kanban_move_card to change its list or position.",
    z.object({
      boardId: id,
      id,
      expectedRevision,
      title: z.string().trim().min(1).max(500).optional(),
      description: z.string().max(20_000).optional(),
      dueDate: z.string().max(100).optional(),
      color: z.enum(["green", "yellow", "red"]).nullable().optional(),
    }).strict(),
    updateAnnotations,
    "openoak:write",
    (userId, input) => kanbanUpdateCard(userId, input as Parameters<typeof kanbanUpdateCard>[1]),
    (result) => `Updated card ${String(result.id)}.`,
  );
  register(
    server,
    "kanban_move_card",
    "Move Kanban card",
    "Move a card to a list and optionally a zero-based position using document-level compare-and-swap.",
    z.object({ boardId: id, id, listId: id, index: z.number().int().nonnegative().optional(), expectedRevision }).strict(),
    updateAnnotations,
    "openoak:write",
    (userId, input) => kanbanMoveCard(userId, input as Parameters<typeof kanbanMoveCard>[1]),
    (result) => `Moved card ${String(result.id)}.`,
  );
  register(
    server,
    "kanban_delete_card",
    "Delete Kanban card",
    "Remove a card using document-level compare-and-swap. Modular boards archive it; legacy document storage deletes permanently. Use v2 reads and operations for recovery. Repeating a completed deletion is safe.",
    z.object({ boardId: id, id, expectedRevision }).strict(),
    deleteAnnotations,
    "openoak:write",
    (userId, input) => kanbanDeleteCard(userId, input as Parameters<typeof kanbanDeleteCard>[1]),
    (result) => result.alreadyAbsent ? "The card was already absent." : `Deleted card ${String(result.id)}.`,
  );

  register(
    server,
    "todo_list_lists",
    "List Todo lists",
    "List Todo lists the authenticated user owns or has joined. Results include owner/editor access, sharing metadata, task counts, stable links, and concurrency timestamps; private system views are not shareable lists.",
    z.object({ limit, cursor }).strict(),
    readAnnotations,
    "openoak:read",
    (userId, input) => todoListLists(userId, input),
    (result) => summaryCount(result, "list"),
  );
  register(
    server,
    "todo_create_list",
    "Create Todo list",
    "Create an owned custom Todo list. Custom lists are the only Todo lists that can be shared.",
    z.object({
      name: z.string().trim().min(1).max(255),
      themeColor: nullableText(100).optional(),
      backgroundImage: nullableText(2_000).optional(),
    }).strict(),
    createAnnotations,
    "openoak:write",
    async (userId, input) => compactEntityMutation(await todoCreateList(userId, input as Parameters<typeof todoCreateList>[1])),
    (result) => `Created list ${String(result.id)}.`,
  );
  register(
    server,
    "todo_update_list",
    "Update Todo list",
    "Update an owned or joined custom Todo list that the user can edit. Requires expectedUpdatedAt and rejects stale writes; invite and access management are not available through this tool.",
    z.object({
      id,
      expectedUpdatedAt,
      name: z.string().trim().min(1).max(255).optional(),
      themeColor: nullableText(100).optional(),
      backgroundImage: nullableText(2_000).optional(),
    }).strict(),
    updateAnnotations,
    "openoak:write",
    async (userId, input) => compactEntityMutation(await todoUpdateList(userId, input as Parameters<typeof todoUpdateList>[1])),
    (result) => `Updated list ${String(result.id)}.`,
  );
  register(
    server,
    "todo_delete_list",
    "Delete Todo list",
    "Permanently delete an owned custom Todo list and all its tasks/subtasks. Joined lists and the private default Tasks list cannot be deleted here. Requires expectedUpdatedAt plus expected task and subtask counts; repeating a completed deletion is safe.",
    z.object({
      id,
      expectedUpdatedAt,
      expectedTaskCount: z.number().int().nonnegative(),
      expectedSubtaskCount: z.number().int().nonnegative(),
    }).strict(),
    deleteAnnotations,
    "openoak:write",
    (userId, input) => todoDeleteList(userId, input as Parameters<typeof todoDeleteList>[1]),
    (result) => result.alreadyAbsent ? "The list was already absent." : `Deleted list ${String(result.id)}.`,
  );

  register(
    server,
    "todo_list_tasks",
    "List Todo tasks",
    "List, filter, or keyword-search compact task summaries in owned and joined Todo lists. Notes are excerpts and subtasks are counts; use todo_get_task for complete notes and subtasks.",
    z.object({
      query: z.string().trim().max(200).optional(),
      listId: id.optional(),
      isCompleted: z.boolean().optional(),
      isImportant: z.boolean().optional(),
      isMyDay: z.boolean().optional(),
      dueFrom: z.string().datetime({ offset: true }).optional(),
      dueTo: z.string().datetime({ offset: true }).optional(),
      limit,
      cursor,
    }).strict(),
    readAnnotations,
    "openoak:read",
    async (userId, input) => {
      const page = await todoListTasks(userId, input);
      return { ...page, items: page.items.map((task) => compactTodoTask(task)) };
    },
    (result) => summaryCount(result, "task"),
  );
  register(
    server,
    "todo_get_task",
    "Get Todo task",
    "Get one task from an owned or joined Todo list with private per-user flags, creator identity, all subtasks, a stable link, and concurrency timestamps.",
    z.object({ id }).strict(),
    readAnnotations,
    "openoak:read",
    (userId, input) => todoGetTask(userId, input.id as string),
    (result) => `Read task ${String(result.id)}.`,
  );
  register(
    server,
    "todo_create_task",
    "Create Todo task",
    "Create a task in an owned or joined editable custom list. Without listId, the user's private default Tasks list is used or created; creator identity is retained independently of later moves.",
    z.object({
      title: z.string().trim().min(1).max(255),
      listId: id.optional(),
      notes: nullableText(10_000).optional(),
      dueDate: z.string().datetime({ offset: true }).nullable().optional(),
      isCompleted: z.boolean().optional(),
      isImportant: z.boolean().optional(),
      isMyDay: z.boolean().optional(),
    }).strict(),
    createAnnotations,
    "openoak:write",
    async (userId, input) => compactTaskMutation(await todoCreateTask(userId, input as Parameters<typeof todoCreateTask>[1])),
    (result) => `Created task ${String(result.id)}.`,
  );
  register(
    server,
    "todo_update_task",
    "Update Todo task",
    "Update shared task content or private isMyDay/isImportant state, or move a task between lists the user can edit. Moving requires edit access to source and destination, retains creator identity, and rejects stale expectedUpdatedAt values.",
    z.object({
      id,
      expectedUpdatedAt,
      title: z.string().trim().min(1).max(255).optional(),
      notes: nullableText(10_000).optional(),
      dueDate: z.string().datetime({ offset: true }).nullable().optional(),
      isCompleted: z.boolean().optional(),
      isImportant: z.boolean().optional(),
      isMyDay: z.boolean().optional(),
      listId: id.optional(),
    }).strict(),
    updateAnnotations,
    "openoak:write",
    async (userId, input) => compactTaskMutation(await todoUpdateTask(userId, input as Parameters<typeof todoUpdateTask>[1])),
    (result) => `Updated task ${String(result.id)}.`,
  );
  register(
    server,
    "todo_delete_task",
    "Delete Todo task",
    "Permanently delete a task from an owned or joined editable list with its subtasks. Requires expectedUpdatedAt and expectedSubtaskCount; repeating a completed deletion is safe.",
    z.object({ id, expectedUpdatedAt, expectedSubtaskCount: z.number().int().nonnegative() }).strict(),
    deleteAnnotations,
    "openoak:write",
    (userId, input) => todoDeleteTask(userId, input as Parameters<typeof todoDeleteTask>[1]),
    (result) => result.alreadyAbsent ? "The task was already absent." : `Deleted task ${String(result.id)}.`,
  );

  register(
    server,
    "todo_create_subtask",
    "Create Todo subtask",
    "Create a subtask under a task in an owned or joined editable Todo list.",
    z.object({ taskId: id, title: z.string().trim().min(1).max(500), isCompleted: z.boolean().optional() }).strict(),
    createAnnotations,
    "openoak:write",
    async (userId, input) => compactSubtaskMutation(await todoCreateSubtask(userId, input as Parameters<typeof todoCreateSubtask>[1])),
    (result) => `Created subtask ${String(result.id)}.`,
  );
  register(
    server,
    "todo_update_subtask",
    "Update Todo subtask",
    "Update a subtask in an owned or joined editable Todo list. Requires expectedUpdatedAt and rejects stale writes.",
    z.object({
      id,
      expectedUpdatedAt,
      title: z.string().trim().min(1).max(500).optional(),
      isCompleted: z.boolean().optional(),
    }).strict(),
    updateAnnotations,
    "openoak:write",
    async (userId, input) => compactSubtaskMutation(await todoUpdateSubtask(userId, input as Parameters<typeof todoUpdateSubtask>[1])),
    (result) => `Updated subtask ${String(result.id)}.`,
  );
  register(
    server,
    "todo_delete_subtask",
    "Delete Todo subtask",
    "Permanently delete a subtask in an owned or joined editable Todo list. Requires expectedUpdatedAt; repeating a completed deletion is safe.",
    z.object({ id, expectedUpdatedAt }).strict(),
    deleteAnnotations,
    "openoak:write",
    (userId, input) => todoDeleteSubtask(userId, input as Parameters<typeof todoDeleteSubtask>[1]),
    (result) => result.alreadyAbsent ? "The subtask was already absent." : `Deleted subtask ${String(result.id)}.`,
  );
}
