import type { Pool } from "pg";
import { kanbanV2ReadSchemas } from "./kanban-v2-schemas.ts";
import { getV2Card, listV2Boards, listV2Cards, listV2Lists, readV2CardDetails, readV2DetailChunk, getV2Changes, getV2Profile, listV2Trash, listV2Archive } from "./kanban-v2-reads.ts";
import { applyKanbanOperation } from "./kanban-operations.ts";

export function kanbanErrorResponse(error: unknown) {
  const candidate = error as { code?: string; message?: string; details?: unknown };
  const status = { invalid: 400, not_found: 404, conflict: 409, operation_id_reused: 409, too_large: 413, restart_read: 409, upgrade_required: 409 }[candidate.code ?? ""];
  return Response.json({ error: status ? { code: candidate.code, message: candidate.message, ...(candidate.details ? { details: candidate.details } : {}) } : { code: "unavailable", message: "OpenKanban is temporarily unavailable." } }, { status: status ?? 503, headers: { "cache-control": "no-store" } });
}

export async function kanbanReadResponse(ownerId: string, resource: string, params: URLSearchParams, database?: Pool, supportsSharing = true) {
  const schema = kanbanV2ReadSchemas[resource as keyof typeof kanbanV2ReadSchemas];
  if (!schema) return Response.json({ error: { code: "not_found", message: "Unknown resource." } }, { status: 404 });
  const input: Record<string, unknown> = Object.fromEntries(params);
  if (params.has("limit")) input.limit = Number(params.get("limit"));
  if (params.has("sinceRevision")) input.sinceRevision = Number(params.get("sinceRevision"));
  if (params.has("ids")) input.ids = params.getAll("ids");
  if (params.has("archived")) input.archived = params.get("archived") === "true" ? true : params.get("archived") === "false" ? false : input.archived;
  const parsed = schema.input.safeParse(input);
  if (!parsed.success) return Response.json({ error: { code: "invalid", message: "Invalid read parameters." } }, { status: 400 });
  try {
    let result: unknown;
    switch (resource) {
      case "archive": result = await listV2Archive(ownerId, parsed.data as Parameters<typeof listV2Archive>[1], database); break;
      case "trash": result = await listV2Trash(ownerId, parsed.data as Parameters<typeof listV2Trash>[1], database); break;
      case "boards": result = await listV2Boards(ownerId, parsed.data as Parameters<typeof listV2Boards>[1], database); break;
      case "lists": result = await listV2Lists(ownerId, parsed.data as Parameters<typeof listV2Lists>[1], database); break;
      case "cards": result = await listV2Cards(ownerId, parsed.data as Parameters<typeof listV2Cards>[1], database); break;
      case "card": result = await getV2Card(ownerId, parsed.data as Parameters<typeof getV2Card>[1], database); break;
      case "card-details": result = await readV2CardDetails(ownerId, parsed.data as Parameters<typeof readV2CardDetails>[1], database); break;
      case "detail-chunks": result = await readV2DetailChunk(ownerId, parsed.data as Parameters<typeof readV2DetailChunk>[1], database); break;
      case "changes": result = await getV2Changes(ownerId, parsed.data as Parameters<typeof getV2Changes>[1], database); break;
      case "profile": result = await getV2Profile(ownerId, database); break;
    }
    const output = schema.output.parse(result);
    if (resource === "boards" && !supportsSharing) {
      const page = kanbanV2ReadSchemas.boards.output.parse(output);
      // Pre-collaboration tabs strictly reject new fields. Preserve their wire
      // format, but never let a client without roles treat joined boards as owned.
      if (page.items.some((board) => board.accessLevel === "editor")) {
        return Response.json({ error: { code: "upgrade_required", message: "OpenKanban was updated. Reload this page to use shared boards. Your unsent edits remain saved on this device." } }, { status: 409, headers: { "cache-control": "no-store" } });
      }
      const items = page.items.map((board) => {
        const legacy = { ...board }; delete legacy.accessLevel; delete legacy.shared; return legacy;
      });
      return Response.json({ ...page, items }, { headers: { "cache-control": "no-store" } });
    }
    return Response.json(output, { headers: { "cache-control": "no-store" } });
  } catch (error) { return kanbanErrorResponse(error); }
}

export async function kanbanOperationResponse(ownerId: string, request: Request, database?: Pool, importing = false) {
  const maxBytes = importing ? 2 * 1024 * 1024 : 65536;
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ error: { code: "invalid", message: "Use application/json." } }, { status: 415 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: { code: "forbidden", message: "Cross-origin writes are not allowed." } }, { status: 403 });
  if (Number(request.headers.get("content-length")) > maxBytes) return Response.json({ error: { code: "too_large", message: importing ? "A board import must fit in 2 MiB." : "An operation must fit in 64 KiB." } }, { status: 413 });
  // Bound the stream itself; content-length can be omitted or inaccurate.
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: { code: "invalid", message: "Missing operation." } }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return Response.json({ error: { code: "too_large", message: importing ? "A board import must fit in 2 MiB." : "An operation must fit in 64 KiB." } }, { status: 413 });
      }
      chunks.push(value);
    }
    let input: unknown;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return Response.json({ error: { code: "invalid", message: "Invalid operation JSON." } }, { status: 400 }); }
    if (importing && (!input || typeof input !== "object" || !("type" in input) || input.type !== "board.import")) return Response.json({ error: { code: "invalid", message: "Expected a board import." } }, { status: 400 });
    const result = await applyKanbanOperation(ownerId, input, database, importing);
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) { return kanbanErrorResponse(error); }
}
