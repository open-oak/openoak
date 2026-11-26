import { z } from "zod";

const id = z.string().min(1).max(2048);
const version = z.number().int().positive();
const index = z.number().int().nonnegative();
const color = z.enum(["default", "blue", "purple", "coral", "green", "gold"]);
const icon = z.enum(["circle", "clock", "check", "flag", "briefcase", "star", "calendar", "todo"]);
const taskColor = z.enum(["green", "yellow", "red"]).nullable();
const name = z.string().trim().min(1).max(160);
const appearance = { theme: color.optional(), wallpaper: z.enum(["none", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]).optional(), wallpaperBlur: z.boolean().optional() };
const cardFields = { title: z.string().max(500).optional(), description: z.string().max(20000).optional(), dueDate: z.string().max(100).optional(), color: taskColor.optional() };
const base = { contractVersion: z.literal(2), operationId: z.string().min(1).max(128), epoch: version, boardKey: id };
const importedTask = z.object({ id, title: z.string(), description: z.string(), dueDate: z.string(), color: taskColor, listId: id, order: index }).strict();
export const kanbanImportedBoardSchema = z.object({
  id, name: z.string().min(1), theme: color, wallpaper: z.enum(["none", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]), wallpaperBlur: z.boolean(),
  lists: z.array(z.object({ id, name: z.string().min(1), color, icon }).strict()).min(1),
  tasks: z.array(importedTask),
  archivedTasks: z.array(importedTask.extend({ archivedAt: z.iso.datetime() }).strict()).optional(),
}).strict().superRefine((board, ctx) => {
  const cards = [...board.tasks, ...(board.archivedTasks ?? [])];
  if (new Set(cards.map((card) => card.id)).size !== cards.length) ctx.addIssue({ code: "custom", message: "Duplicate active/archive identities" });
  if (new Set(board.lists.map((list) => list.id)).size !== board.lists.length || new Set(board.tasks.map((card) => card.id)).size !== board.tasks.length) ctx.addIssue({ code: "custom", message: "Duplicate import identities" });
  if (board.tasks.some((card) => !board.lists.some((list) => list.id === card.listId))) ctx.addIssue({ code: "custom", message: "Unknown import list" });
  for (const list of board.lists) if (board.tasks.filter((card) => card.listId === list.id).sort((a, b) => a.order - b.order).some((card, index) => card.order !== index)) ctx.addIssue({ code: "custom", message: "Invalid import order" });
});

export const kanbanMcpOperationSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("board.create"), id, name, ...appearance, expectedBoardOrderVersion: version }).strict(),
  z.object({ ...base, type: z.literal("board.update"), expectedMetadataVersion: version, changes: z.object({ name: name.optional(), ...appearance }).strict().refine((value) => Object.keys(value).length > 0) }).strict(),
  z.object({ ...base, type: z.literal("board.delete"), expectedRevision: version, replacement: z.object({ id, boardKey: id }).strict().optional() }).strict(),
  z.object({ ...base, type: z.literal("list.create"), listId: id, name, color: color.optional(), icon: icon.optional(), expectedListOrderVersion: version }).strict(),
  z.object({ ...base, type: z.literal("list.update"), listId: id, expectedMetadataVersion: version, changes: z.object({ name: name.optional(), color: color.optional(), icon: icon.optional() }).strict().refine((value) => Object.keys(value).length > 0) }).strict(),
  z.object({ ...base, type: z.literal("list.move"), listId: id, expectedListOrderVersion: version, index }).strict(),
  z.object({ ...base, type: z.literal("list.delete"), listId: id, expectedRevision: version }).strict(),
  z.object({ ...base, type: z.literal("card.create"), cardId: id, listId: id, expectedOrderVersion: version, ...cardFields, title: z.string().max(500) }).strict(),
  z.object({ ...base, type: z.literal("card.update"), cardId: id, expectedContentVersion: version, changes: z.object(cardFields).strict().refine((value) => Object.keys(value).length > 0) }).strict(),
  z.object({ ...base, type: z.literal("card.move"), cardId: id, expectedPlacementVersion: version, sourceListId: id, destinationListId: id, expectedOrderVersions: z.record(z.string(), version), index }).strict(),
  z.object({ ...base, type: z.literal("card.archive"), cardId: id, expectedContentVersion: version, expectedPlacementVersion: version }).strict(),
  z.object({ ...base, type: z.literal("card.delete"), cardId: id, expectedContentVersion: version, expectedPlacementVersion: version }).strict(),
  z.object({ ...base, type: z.literal("card.restore"), cardId: id, deletionId: id, destinationListId: id.optional() }).strict(),
  z.object({ ...base, type: z.literal("card.purge"), cardId: id, deletionId: id, confirmPermanent: z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal("archive.purge"), expectedRevision: version, confirmPermanent: z.literal(true) }).strict(),
  z.object({ ...base, type: z.literal("profile.selectBoard"), expectedProfileVersion: version }).strict(),
]);
export const kanbanOperationSchema = z.discriminatedUnion("type", [
  ...kanbanMcpOperationSchema.options,
  z.object({ ...base, type: z.literal("board.import"), board: kanbanImportedBoardSchema, expectedBoardOrderVersion: version }).strict(),
]);
export type KanbanOperation = z.infer<typeof kanbanOperationSchema>;

export const kanbanOperationResultSchema = z.object({
  operationId: z.string(), status: z.enum(["applied", "duplicate", "no_op"]), epoch: version,
  boardKey: id, revision: version, refreshRequired: z.boolean(),
  changed: z.array(z.object({ kind: z.enum(["board", "list", "card", "profile"]), id: z.string(), deleted: z.boolean().optional(), contentVersion: version.optional(), placementVersion: version.optional(), metadataVersion: version.optional(), orderVersion: version.optional() }).strict()).max(50),
  replacement: z.object({ boardKey: id, id }).strict().optional(),
  refreshCursor: z.string().optional(),
}).strict();
export type KanbanOperationResult = z.infer<typeof kanbanOperationResultSchema>;
