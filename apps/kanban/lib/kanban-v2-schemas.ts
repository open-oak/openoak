import { z } from "zod";

const id = z.string().max(2048);
const version = z.number().int().positive();
const position = z.number().int().nonnegative();
const pagination = { limit: z.number().int().min(1).max(50).optional(), cursor: z.string().max(8192).optional() };
const boardPage = z.object(pagination).strict();
const listPage = z.object({ boardKey: id, ...pagination }).strict();
const cardPage = listPage.extend({ listId: id.optional(), query: z.string().max(200).optional(), ids: z.array(id).max(50).optional() }).strict();
const cardInput = z.object({ boardKey: id, id, archived: z.boolean().optional() }).strict();
const chunkInput = cardInput.extend({ cursor: z.string().min(1).max(8192) }).strict();
// Read responses accept additive fields across releases; known fields still validate.
// Request schemas remain strict.
const card = z.object({ boardKey: id, boardId: id, id, listId: id, order: position, title: z.string(), description: z.string(), dueDate: z.string(), color: z.enum(["green", "yellow", "red"]).nullable(), contentVersion: version, placementVersion: version, url: z.string(), archivedAt: z.string().optional(), deletionId: id.optional() }).strip();
const cardSummary = card.omit({ description: true }).extend({ descriptionExcerpt: z.string().max(240) }).strip();
const detail = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("card"), card }).strip(),
  z.object({ kind: z.literal("detail_required"), boardKey: id, id, cursor: z.string() }).strip(),
]);
const nextPage = { nextCursor: z.string().optional() };
const boardResult = z.object({ epoch: version, boardOrderVersion: version, items: z.array(z.object({ boardKey: id, id, accessLevel: z.enum(["owner", "editor"]).optional(), shared: z.boolean().optional(), name: z.string(), theme: z.string(), wallpaper: z.string(), wallpaperBlur: z.boolean(), position, cardCount: position, listCount: position, revision: version, metadataVersion: version, listOrderVersion: version, updatedAt: z.string(), url: z.string() }).strip()), ...nextPage }).strip();
const list = z.object({ id, name: z.string(), color: z.string(), icon: z.string(), position, metadataVersion: version, orderVersion: version, cardCount: position }).strip();
const listResult = z.object({ epoch: version, boardKey: id, revision: version, items: z.array(list), ...nextPage }).strip();
const cardsResult = listResult.extend({ items: z.array(cardSummary) }).strip();
const detailsResult = listResult.extend({ items: z.array(detail) }).strip();
const oneResult = z.object({ epoch: version, result: detail }).strip();
const chunkResult = z.object({ epoch: version, boardKey: id, id, jsonFragment: z.string(), ...nextPage }).strip();
const changesInput = listPage.extend({ sinceRevision: z.number().int().nonnegative().optional() }).strict();
const changesResult = listResult.extend({ items: z.array(z.object({ revision: version, sequence: position, kind: z.enum(["board", "list", "card", "profile"]), id, deleted: z.boolean() }).strip()) }).strip();
const profileResult = z.object({ epoch: version, accountKey: z.string(), activeBoardKey: id, boardOrderVersion: version, version }).strip();

export const kanbanV2ReadSchemas = {
  boards: { input: boardPage, output: boardResult },
  archive: { input: listPage.extend({ query: z.string().max(200).optional() }).strict(), output: listResult.extend({ items: z.array(z.object({ id, listId: id, title: z.string(), deletionId: id, archivedAt: z.string(), color: z.enum(["green", "yellow", "red"]).nullable().optional(), contentVersion: version, placementVersion: version }).strip()) }).strip() },
  trash: { input: listPage.extend({ id: id.optional() }).strict(), output: listResult.extend({ items: z.array(z.object({ id, listId: id, title: z.string(), deletionId: id, deletedAt: z.string(), contentVersion: version, placementVersion: version }).strip()) }).strip() },
  lists: { input: listPage, output: listResult },
  cards: { input: cardPage, output: cardsResult },
  card: { input: cardInput, output: oneResult },
  "card-details": { input: cardPage, output: detailsResult },
  "detail-chunks": { input: chunkInput, output: chunkResult },
  changes: { input: changesInput, output: changesResult },
  profile: { input: z.object({}).strict(), output: profileResult },
};
